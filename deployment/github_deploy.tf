# GitHub Actions deploys releases over IAP SSH. It authenticates with Workload
# Identity Federation, so no service account key exists anywhere.

resource "google_project_service" "deploy" {
  for_each = toset([
    "iamcredentials.googleapis.com",
    "iap.googleapis.com",
    "oslogin.googleapis.com",
    "sts.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-deploy"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.deploy]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.ref"         = "assertion.ref"
    "attribute.environment" = "assertion.environment"
  }

  # Only the production environment on main of this repository can get tokens.
  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "github_deployer" {
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer"
}

resource "google_service_account_iam_member" "github_deployer_wif" {
  service_account_id = google_service_account.github_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Lets `gcloud compute ssh` look up the instance.
resource "google_project_iam_member" "github_deployer_compute_viewer" {
  project = var.project_id
  role    = "roles/compute.viewer"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}

# OS Login requires actAs on the VM's attached service account.
resource "google_service_account_iam_member" "github_deployer_act_as_vm" {
  service_account_id = google_service_account.vm_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

# Non-admin login: the only sudo it gets is the deploy script (see startup.sh.tftpl).
resource "google_compute_instance_iam_member" "github_deployer_os_login" {
  project       = var.project_id
  zone          = var.project_zone
  instance_name = google_compute_instance.default.name
  role          = "roles/compute.osLogin"
  member        = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_iap_tunnel_instance_iam_member" "github_deployer_iap" {
  project  = var.project_id
  zone     = var.project_zone
  instance = google_compute_instance.default.name
  role     = "roles/iap.tunnelResourceAccessor"
  member   = "serviceAccount:${google_service_account.github_deployer.email}"

  depends_on = [google_project_service.deploy]
}

output "github_wif_provider" {
  description = "GitHub repository variable GCP_WIF_PROVIDER"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_email" {
  description = "GitHub repository variable GCP_DEPLOYER_SA"
  value       = google_service_account.github_deployer.email
}

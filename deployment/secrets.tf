resource "google_secret_manager_secret_iam_member" "vm_flask_secret_accessor" {
  project   = var.project_id
  secret_id = var.secret_name_flask
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "vm_cloudflare_origin_cert_secret_accessor" {
  project   = var.project_id
  secret_id = var.secret_name_cloudflare_origin_certificate
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "vm_cloudflare_private_key_secret_accessor" {
  project   = var.project_id
  secret_id = var.secret_name_cloudflare_private_key
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm_runtime.email}"
}
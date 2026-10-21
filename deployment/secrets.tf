resource "google_secret_manager_secret_iam_member" "vm_flask_secret_accessor" {
  project   = var.project_id
  secret_id = var.secret_name_flask
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm_runtime.email}"
}

# Terraform creates this secret itself because it is the one generating the
# tunnel token. The VM reads it at boot, like the other secrets.
resource "google_secret_manager_secret" "cloudflare_tunnel_token" {
  project   = var.project_id
  secret_id = var.secret_name_cloudflare_tunnel_token

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "cloudflare_tunnel_token" {
  secret = google_secret_manager_secret.cloudflare_tunnel_token.id
  # Write-only, so the token isn't stored a second time in Terraform state.
  secret_data_wo         = cloudflare_zero_trust_tunnel_cloudflared.website.tunnel_token
  secret_data_wo_version = 1
}

resource "google_secret_manager_secret_iam_member" "vm_cloudflare_tunnel_token_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.cloudflare_tunnel_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm_runtime.email}"
}

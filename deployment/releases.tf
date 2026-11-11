# The last successfully deployed release, so a replaced VM can install it on
# first boot without waiting for a manual deploy. Deploy overwrites one object.

resource "google_storage_bucket" "releases" {
  name = "${var.project_id}-releases"
  # Free tier covers only single regions in us-central1, us-east1, and us-west1;
  # same region as the VM also makes the download free.
  location      = upper(var.project_region)
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # No versioning: old copies would accumulate storage. Actions keeps 30 days of artifacts.
  versioning {
    enabled = false
  }
}

resource "google_storage_bucket_iam_member" "vm_releases_reader" {
  bucket = google_storage_bucket.releases.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.vm_runtime.email}"
}

# objectUser, not objectCreator: overwriting latest.tar.gz also needs objects.delete.
resource "google_storage_bucket_iam_member" "github_deployer_releases_writer" {
  bucket = google_storage_bucket.releases.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.github_deployer.email}"
}

output "release_bucket" {
  description = "Bucket the Deploy workflow publishes the latest release to (GCS_RELEASE_BUCKET in deploy.yaml)"
  value       = google_storage_bucket.releases.name
}

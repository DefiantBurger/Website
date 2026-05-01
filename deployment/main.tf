provider "google" {
  project = var.project_id
  region  = var.project_region
}

provider "google-beta" {
  project = var.project_id
  region  = var.project_region
}

resource "google_compute_network" "vpc_network" {
  name                    = "my-custom-mode-network"
  auto_create_subnetworks = false
  mtu                     = 1460

  lifecycle {
    create_before_destroy = false
  }
}

resource "google_compute_subnetwork" "default" {
  name          = "my-custom-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.project_region
  network       = google_compute_network.vpc_network.id
}

locals {
  nginx_conf = templatefile("${path.module}/nginx.tftpl", {
    domain   = var.domain
    app_path = var.app_path
  })
  flaskapp_service = templatefile("${path.module}/flaskapp.service.tftpl", {
    app_path     = var.app_path
    flask_secret = data.google_secret_manager_secret_version.flask-secret.secret_data
    mongodb_uri  = data.google_secret_manager_secret_version.mongodb-uri.secret_data
  })
}


# Create a single Compute Engine instance
resource "google_compute_instance" "default" {
  name         = "flask-vm"
  machine_type = "e2-micro"
  zone         = var.project_zone
  tags         = ["ssh"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh.tftpl", {
    domain           = var.domain
    app_path         = var.app_path
    repo_url         = var.repo_url
    repo_branch      = var.repo_branch
    flaskapp_service = base64encode(local.flaskapp_service)
    cloudflare_cert  = base64encode(data.google_secret_manager_secret_version.cloudflare-origin-certificate.secret_data)
    cloudflare_key   = base64encode(data.google_secret_manager_secret_version.cloudflare-private-key.secret_data)
    nginx_conf       = base64encode(local.nginx_conf)
  })


  network_interface {
    subnetwork = google_compute_subnetwork.default.id

    access_config {
      # Include this section to give the VM an external IP address
    }
  }
}

# Allows SSH access via GCP website
resource "google_compute_firewall" "allow_iap_ssh" {
  name      = "allow-iap-ssh"
  network   = google_compute_network.vpc_network.id
  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"] # Google's IAP TCP forwarding IP range
  target_tags   = ["ssh"]

  depends_on = [google_compute_network.vpc_network]
}

resource "google_compute_firewall" "flask" {
  name    = "flask-app-firewall"
  network = google_compute_network.vpc_network.id

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  source_ranges = [
    # Only allows access from Cloudflare's IPs
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22"
  ]

  depends_on = [google_compute_network.vpc_network]
}

output "Web-server-URL" {
  description = "The IP for the website"
  value       = google_compute_instance.default.network_interface[0].access_config[0].nat_ip
}
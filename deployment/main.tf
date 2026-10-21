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
  nginx_conf = templatefile("${path.module}/nginx.conf.tftpl", {
    domain   = var.domain
    app_path = var.app_path
  })
  nginx_api_proxy_params = templatefile("${path.module}/nginx_api_proxy_params.conf.tftpl", {})
  flaskapp_service = templatefile("${path.module}/flaskapp.service.tftpl", {
    app_path = var.app_path
  })
  cloudflared_service = templatefile("${path.module}/cloudflared.service.tftpl", {})
  deploy_script = templatefile("${path.module}/deploy.sh.tftpl", {
    app_path = var.app_path
  })
}

resource "google_service_account" "vm_runtime" {
  account_id   = "flask-vm-runtime"
  display_name = "Flask VM runtime service account"
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

  metadata = {
    # GitHub Actions deploys over IAP SSH as an OS Login user (see github_deploy.tf).
    enable-oslogin = "TRUE"
    # Publishes host keys so gcloud can verify them instead of trusting on first use.
    enable-guest-attributes = "TRUE"
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh.tftpl", {
    domain                              = var.domain
    app_path                            = var.app_path
    deploy_script                       = base64encode(local.deploy_script)
    deployer_username                   = "sa_${google_service_account.github_deployer.unique_id}"
    flaskapp_service                    = base64encode(local.flaskapp_service)
    cloudflared_service                 = base64encode(local.cloudflared_service)
    nginx_conf                          = base64encode(local.nginx_conf)
    nginx_api_proxy_params              = base64encode(local.nginx_api_proxy_params)
    secret_name_flask                   = var.secret_name_flask
    secret_version_flask                = var.secret_version_flask
    secret_name_cloudflare_tunnel_token = var.secret_name_cloudflare_tunnel_token
  })


  network_interface {
    subnetwork = google_compute_subnetwork.default.id

    access_config {
      # External IP for outbound traffic only (apt, PyPI, the tunnel). No firewall
      # rule allows inbound web traffic; it all arrives through the tunnel.
    }
  }

  service_account {
    email  = google_service_account.vm_runtime.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.vm_flask_secret_accessor,
    google_secret_manager_secret_iam_member.vm_cloudflare_tunnel_token_accessor,
    google_secret_manager_secret_version.cloudflare_tunnel_token,
  ]
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

output "Web-server-URL" {
  description = "The IP for the website"
  value       = google_compute_instance.default.network_interface[0].access_config[0].nat_ip
}
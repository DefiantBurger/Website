provider "google" {
  project = var.project_id
  region  = var.project_region
}

resource "google_compute_network" "vpc_network" {
  name                    = "my-custom-mode-network"
  auto_create_subnetworks = false
  mtu                     = 1460
}

resource "google_compute_subnetwork" "default" {
  name          = "my-custom-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.project_region
  network       = google_compute_network.vpc_network.id
}

locals {
  vm = "${path.module}/vm"
  # Every .tftpl in vm/ gets all of these; templatefile ignores the ones it doesn't use.
  vm_template_vars = {
    domain            = var.domain
    app_path          = var.app_path
    data_path         = var.data_path
    backend_port      = var.backend_port
    deployer_username = "sa_${google_service_account.github_deployer.unique_id}"
  }

  # Root-owned files the startup script installs on every boot, by destination. Where a
  # file goes decides how a change to it is applied (apply_changes in startup.sh.tftpl).
  vm_files = {
    "/etc/apt/apt.conf.d/52personalwebsite"           = { mode = "644", content = file("${local.vm}/unattended-upgrades.conf") }
    "/etc/sysctl.d/99-personalwebsite.conf"           = { mode = "644", content = file("${local.vm}/sysctl.conf") }
    "/etc/default/instance_configs.cfg"               = { mode = "644", content = file("${local.vm}/instance_configs.cfg") }
    "/etc/sudoers.d/personalwebsite-deploy"           = { mode = "440", content = templatefile("${local.vm}/sudoers.tftpl", local.vm_template_vars) }
    "/usr/local/sbin/personalwebsite-deploy"          = { mode = "755", content = templatefile("${local.vm}/deploy.sh.tftpl", local.vm_template_vars) }
    "/etc/nginx/sites-available/default"              = { mode = "644", content = templatefile("${local.vm}/nginx.conf.tftpl", local.vm_template_vars) }
    "/etc/nginx/api_proxy_params.conf"                = { mode = "644", content = templatefile("${local.vm}/nginx_api_proxy_params.conf.tftpl", local.vm_template_vars) }
    "/etc/systemd/system/flaskapp.service"            = { mode = "644", content = templatefile("${local.vm}/flaskapp.service.tftpl", local.vm_template_vars) }
    "/etc/systemd/system/flaskapp-firewall.service"   = { mode = "644", content = file("${local.vm}/flaskapp-firewall.service") }
    "/etc/nftables.d/flaskapp-firewall.nft"           = { mode = "644", content = file("${local.vm}/flaskapp-firewall.nft") }
    "/etc/systemd/system/cloudflared.service"         = { mode = "644", content = templatefile("${local.vm}/cloudflared.service.tftpl", local.vm_template_vars) }
    "/etc/systemd/system/cloudflared-restart.path"    = { mode = "644", content = file("${local.vm}/cloudflared-restart.path") }
    "/etc/systemd/system/cloudflared-restart.service" = { mode = "644", content = file("${local.vm}/cloudflared-restart.service") }
  }

  startup_script = templatefile("${path.module}/startup.sh.tftpl", {
    app_path                            = var.app_path
    data_path                           = var.data_path
    vm_files                            = local.vm_files
    secret_name_flask                   = var.secret_name_flask
    secret_version_flask                = var.secret_version_flask
    secret_name_cloudflare_tunnel_token = var.secret_name_cloudflare_tunnel_token
    release_bucket                      = google_storage_bucket.releases.name
  })

  # Everything that would need a new VM or a stop/start. Changing any of it renames the
  # VM, which makes the change a zero-downtime swap (see "VM swaps" in DEPLOYMENT.md).
  vm_spec = {
    # A pinned image, not the debian-13 family, so the kernel only changes on purpose
    # (unattended-upgrades skips kernels). See "Kernel updates" in DEPLOYMENT.md.
    image        = "debian-cloud/debian-13-trixie-v20261116"
    machine_type = "e2-micro"
    zone         = var.project_zone
  }
}

resource "google_service_account" "vm_runtime" {
  account_id   = "flask-vm-runtime"
  display_name = "Flask VM runtime service account"
}

# Random rather than derived from vm_spec: rolling back a failed swap returns to an old
# spec while the VM that last used it may still exist, and names must be unique.
resource "random_id" "vm" {
  byte_length = 3
  keepers     = local.vm_spec
}

resource "google_compute_instance" "default" {
  name         = "flask-vm-${random_id.vm.hex}"
  machine_type = local.vm_spec.machine_type
  zone         = local.vm_spec.zone
  tags         = ["ssh"]
  # How the Deploy workflow and deployment/ssh.sh find the VM, since its name changes.
  labels = { app = "personalwebsite" }

  boot_disk {
    initialize_params {
      image = local.vm_spec.image
    }
  }

  metadata = {
    # GitHub Actions deploys over IAP SSH as an OS Login user (see github_deploy.tf).
    enable-oslogin = "TRUE"
    # Publishes host keys so gcloud can verify them instead of trusting on first use,
    # and carries the startup script's readiness signal (see vm_ready below).
    enable-guest-attributes = "TRUE"
    # Copies serial port 1 (kernel + journald console output) to Cloud Logging from
    # outside the guest, so logs survive a hung VM. Volume is far below the free tier.
    serial-port-logging-enable = "TRUE"
    # Overrides the project's enable-osconfig=TRUE. VM Manager (inventory, patch jobs,
    # OS policies) goes unused, since unattended-upgrades patches the VM, and its
    # inventory report logged to the serial console every 10 minutes.
    enable-osconfig = "FALSE"
    # This key, unlike metadata_startup_script, updates in place instead of replacing the
    # VM. A change reaches the VM on its next boot or a manual run (see RUNBOOK.md).
    startup-script = local.startup_script
  }

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

  # A swap starts the new VM before the old one goes away.
  lifecycle {
    create_before_destroy = true
  }
}

# Waits until the new VM serves a release through the tunnel. Terraform destroys the old
# VM only after this succeeds, since a create_before_destroy object is destroyed after
# its replacement's dependents are created. If it fails, the old VM keeps serving.
resource "terraform_data" "vm_ready" {
  triggers_replace = google_compute_instance.default.id

  provisioner "local-exec" {
    command = "${path.module}/wait-for-vm.sh"
    environment = {
      VM      = google_compute_instance.default.name
      ZONE    = google_compute_instance.default.zone
      PROJECT = var.project_id
    }
  }
}

output "vm_name" {
  description = "The current VM's name (it changes on every swap)"
  value       = google_compute_instance.default.name
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
}

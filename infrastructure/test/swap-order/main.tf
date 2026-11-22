# Local stand-ins for main.tf's swap resources, to check the Terraform behavior swaps rely
# on: "vm" is google_compute_instance.default, "ready" is terraform_data.vm_ready, and
# "iam" is an instance IAM binding. Nothing here touches the cloud.
variable "image" {}
variable "ready" { default = true }

resource "terraform_data" "vm" {
  input            = "vm-${var.image}"
  triggers_replace = var.image # Like the instance's name, which changes with vm_spec.
  lifecycle {
    create_before_destroy = true
  }
}

resource "terraform_data" "ready" {
  triggers_replace = terraform_data.vm.id
  provisioner "local-exec" {
    command = "sleep 1; ${var.ready}"
  }
}

resource "terraform_data" "iam" {
  triggers_replace = terraform_data.vm.id # Bound by VM name, which is unique per VM.
  depends_on       = [terraform_data.ready]
  lifecycle {
    create_before_destroy = true
  }
}

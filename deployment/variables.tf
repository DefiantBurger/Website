variable "domain" {
  description = "The domain name you are configuring."
  type        = string
  default     = "josephcicalese.com"
}

variable "app_path" {
  description = "Path of the flask app"
  type        = string
  default     = "/opt/personalwebsite"
}

variable "repo_url" {
  description = "Git repository URL used by VM startup bootstrap"
  type        = string
  default     = "https://github.com/DefiantBurger/Website"
}

variable "repo_branch" {
  description = "Git branch deployed by VM startup bootstrap"
  type        = string
  default     = "main"
}

variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "personal-website-453120"
}

variable "project_region" {
  description = "GCP region of project"
  type        = string
  default     = "us-central1"
}

variable "project_zone" {
  description = "GCP zone of project"
  type        = string
  default     = "us-central1-a"
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for DNS record management"
  type        = string
  default     = "9d742195068bb58a363dfdf2e17ec7e5"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the tunnel"
  type        = string
  default     = "299dfe93c8f42147f7977fab1abad5b2"
}

variable "secret_name_flask" {
  description = "Secret Manager secret name for Flask SECRET_KEY"
  type        = string
  default     = "flask-secret"
}

variable "secret_name_cloudflare_tunnel_token" {
  description = "Secret Manager secret name (created by Terraform) for the Cloudflare Tunnel token"
  type        = string
  default     = "cloudflare-tunnel-token"
}

variable "secret_version_flask" {
  description = "Secret version for Flask secret"
  type        = string
  default     = "latest"
}

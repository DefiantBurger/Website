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
terraform {
  required_version = ">= 1.12.2, < 2.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.27.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.27.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.52.7"
    }
  }
}
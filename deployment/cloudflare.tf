provider "cloudflare" {
}

resource "cloudflare_record" "website_a_record" {
  zone_id = var.cloudflare_zone_id
  name    = "@"
  content = google_compute_instance.default.network_interface[0].access_config[0].nat_ip
  type    = "A"
  proxied = true
  comment = "Redirect to flask app"

  lifecycle {
    create_before_destroy = false
  }
}
provider "cloudflare" {
}

# The tunnel secret only needs to exist; cloudflared authenticates with the
# tunnel token derived from it.
resource "random_id" "tunnel_secret" {
  byte_length = 32
}

# The VM opens an outbound connection to Cloudflare, so the origin accepts no
# inbound web traffic and can only be reached through this zone.
resource "cloudflare_zero_trust_tunnel_cloudflared" "website" {
  account_id = var.cloudflare_account_id
  name       = "personal-website"
  secret     = random_id.tunnel_secret.b64_std
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "website" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.website.id

  config {
    ingress_rule {
      hostname = var.domain
      service  = "http://localhost:80"
    }

    ingress_rule {
      service = "http_status:404"
    }
  }
}

moved {
  from = cloudflare_record.website_a_record
  to   = cloudflare_record.website
}

resource "cloudflare_record" "website" {
  zone_id = var.cloudflare_zone_id
  name    = "@"
  content = cloudflare_zero_trust_tunnel_cloudflared.website.cname
  type    = "CNAME"
  proxied = true
  comment = "Route to the Cloudflare Tunnel on the flask VM"

  lifecycle {
    create_before_destroy = false
  }
}

# Adds cf-ipcity, cf-region, cf-postal-code, etc. to requests sent to the origin.
# Used by /api/about-you/request-context/ instead of a third-party lookup.
resource "cloudflare_managed_headers" "website" {
  zone_id = var.cloudflare_zone_id

  managed_request_headers {
    id      = "add_visitor_location_headers"
    enabled = true
  }
}

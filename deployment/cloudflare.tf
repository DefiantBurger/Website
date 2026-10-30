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

# Originally created by hand in the dashboard.
import {
  to = cloudflare_record.www
  id = "${var.cloudflare_zone_id}/313cd5c0c7a68ae405aae8fa8271f0d5"
}

# Proxied so www resolves to Cloudflare. The redirect rule below answers every
# request, so nothing is ever forwarded to the apex through this record.
resource "cloudflare_record" "www" {
  zone_id = var.cloudflare_zone_id
  name    = "www"
  content = var.domain
  type    = "CNAME"
  proxied = true
  comment = "Redirected to the apex by cloudflare_ruleset.www_redirect"
}

# A zone allows only one ruleset per phase, so any other dynamic redirects
# belong in this resource as additional rules.
resource "cloudflare_ruleset" "www_redirect" {
  zone_id = var.cloudflare_zone_id
  name    = "Redirect www to apex"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules {
    action      = "redirect"
    expression  = "(http.host eq \"www.${var.domain}\")"
    description = "301 www to apex"
    enabled     = true

    action_parameters {
      from_value {
        status_code           = 301
        preserve_query_string = true
        target_url {
          expression = "concat(\"https://${var.domain}\", http.request.uri.path)"
        }
      }
    }
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

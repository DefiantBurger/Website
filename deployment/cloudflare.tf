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

# Cloudflare is the registrar, so it publishes the DS record itself.
resource "cloudflare_zone_dnssec" "website" {
  zone_id = var.cloudflare_zone_id
}

# Cloudflare's edge certs (Google Trust Services, Let's Encrypt, SSL.com) and
# Better Stack's status page cert (Let's Encrypt) are the only issuers needed.
resource "cloudflare_record" "caa" {
  for_each = toset(["pki.goog", "letsencrypt.org", "ssl.com"])

  zone_id = var.cloudflare_zone_id
  name    = "@"
  type    = "CAA"

  data {
    flags = 0
    tag   = "issue"
    value = each.value
  }
}

# The records below were created by hand. Provider v4 can only import records
# by ID, so these look the IDs up by name.
data "cloudflare_record" "status" {
  zone_id  = var.cloudflare_zone_id
  hostname = "status.${var.domain}"
  type     = "CNAME"
}

data "cloudflare_record" "google_verification" {
  zone_id  = var.cloudflare_zone_id
  hostname = var.domain
  type     = "TXT"
  content  = "\"google-site-verification=S2_J8VjZGHhEme8vuZRw_kri4SnOEaIxTzRTbf9DECE\""
}

data "cloudflare_record" "dmarc" {
  zone_id  = var.cloudflare_zone_id
  hostname = "_dmarc.${var.domain}"
  type     = "TXT"
}

import {
  to = cloudflare_record.status
  id = "${var.cloudflare_zone_id}/${data.cloudflare_record.status.id}"
}

import {
  to = cloudflare_record.google_verification
  id = "${var.cloudflare_zone_id}/${data.cloudflare_record.google_verification.id}"
}

import {
  to = cloudflare_record.dmarc
  id = "${var.cloudflare_zone_id}/${data.cloudflare_record.dmarc.id}"
}

# Must stay DNS only, or Better Stack can't serve the page or renew its cert.
resource "cloudflare_record" "status" {
  zone_id = var.cloudflare_zone_id
  name    = "status"
  content = "statuspage.betteruptime.com"
  type    = "CNAME"
  proxied = false
  comment = "Better Stack status page"
}

resource "cloudflare_record" "google_verification" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  content = data.cloudflare_record.google_verification.content
  type    = "TXT"
  comment = "Google Search Console ownership"
}

# Created by DMARC Management, whose rua address receives the reports. Nothing
# sends mail as this domain, so anything claiming to is rejected.
resource "cloudflare_record" "dmarc" {
  zone_id = var.cloudflare_zone_id
  name    = "_dmarc"
  content = "\"v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; ${regex("rua=[^;\"]+", data.cloudflare_record.dmarc.value)}\""
  type    = "TXT"
  comment = "No mail is sent from this domain"
}

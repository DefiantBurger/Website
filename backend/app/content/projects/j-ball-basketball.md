---
title: "J-Ball Basketball"
slug: "j-ball-basketball"
summary: "A client website for a Jewish high school basketball league, with schedules, standings, photos, signup flows, sponsor visibility, and an admin area for content updates."
priority: 10
tags:
  - "Flask"
  - "JavaScript"
  - "Vercel"
  - "HTML"
  - "CSS"
  - "Client Work"
repo: "https://github.com/JBallBasketball/JBallBasketballWebsite"
demo: "https://www.jballbasketball.com/"
published: true
---

## Overview

J-Ball Basketball is a nonprofit Jewish high school basketball league serving players across the Greater Philadelphia area. I was brought in to build and maintain the public site as paid client work, so the project needed to support both the league’s public presence and its day-to-day content updates.

The site presents the league as both a sports platform and a community space: it explains the mission, routes players into signup flows, publishes schedules and standings, highlights event photography, and keeps sponsors visible throughout the experience.

What makes the project interesting is the blend of public-facing storytelling and operational utility. The site is not just a brochure. It has to support season-to-season updates, communicate tournament information clearly, and give families and players a simple way to find the right next action.

## Why I Built It

The goal was to create a website that could do three things well:

1. Make the league easy to understand for new visitors.
2. Give returning players a quick path to schedules, standings, and signups.
3. Present sponsors and league supporters in a polished, credible way.

For a community league like this, the site has to be practical first. People visit for a specific reason: to see when games are happening, whether a tournament is open, how teams are ranked, or how to contact the league. The design and content structure need to answer those questions fast.

Because this was client work, I also had to think about maintainability from the start. The site needed to be easy for the organization to update without exposing unnecessary administrative complexity to the public.

## Site Structure

The public site is organized around a small set of high-value pages:

- Home page with the league overview and calls to action.
- Calendar page for upcoming games and season timing.
- Standings page for competitive status and team progress.
- Photos page for event highlights and social proof.
- Signup page for current tournaments and season registration.
- Contact page for email, Instagram, and Remind.

That structure matches how people actually use the league. First they learn what J-Ball is, then they look for the live details that matter to participation.

## What The Site Communicates

The homepage frames J-Ball as a nonprofit league for Jewish high school boys, hosted at the Kaiserman JCC in Wynnewood and centered on Sunday night games. That positioning matters because it communicates audience, venue, and rhythm immediately.

The signup flow is equally important. The site presents multiple tournament options, including alumni and charity events, and makes the regular season easy to find. That keeps the league accessible to players with different entry points.

The photos and sponsors sections do another kind of work. Photos provide a sense of momentum and continuity across seasons, while sponsor placement reinforces that the league is community-supported and professionally maintained.

## Admin Area

The site also includes an admin area for updating event photos, sponsor content, and tournament information. That part of the system matters because the league’s content changes over time, and the people maintaining it need a straightforward place to refresh the public site without rebuilding the whole project.

From a security perspective, the admin surface should stay narrow and deliberate:

- access should be restricted to authorized users only,
- write actions should be separated from public read pages,
- form submissions should be protected against CSRF,
- sensitive credentials and update tokens should stay server-side,
- and any externally hosted content sources should be treated as untrusted input.

That keeps the admin workflow useful for the organization without broadening the attack surface of the public site.

## Notable Features

- Clear league identity centered on community, athletics, and Jewish identity.
- Multiple entry points for players, including regular season and tournament signups.
- Dedicated pages for calendar, standings, photos, and contact information.
- Sponsor visibility baked into the site rather than hidden in a footer.
- Lightweight public navigation that favors quick answers over heavy content.

## Portfolio Value

This project is a good example of a site that needs to balance communication, organization, trust, and ongoing maintenance.

From a portfolio perspective, it shows that I can build a public-facing site for a real community organization with a clear information hierarchy and practical page structure. It also shows that I can deliver client work that supports recurring seasonal content without turning the site into a maintenance burden.

## Takeaways

The main lesson from J-Ball is that a successful community site does not need to be complicated. It needs to be dependable, readable, and easy to update when the season changes.

That means the site should always make the next action obvious, whether that is checking a schedule, opening a signup, viewing standings, or contacting the league.
---
title: Privacy
permalink: /privacy/
description: What this site stores about the people who read it, write to it and comment on it, and for how long.
---

> **To the owner of this site.** `geekity init` wrote this page from what the
> Geekity CMS does out of the box. It is a starting point, not legal advice,
> and it knows nothing about your hosting, your analytics, your mail provider
> or anything you added. Review it, correct it, and delete this note before
> you rely on it. If you change a retention period on Settings > Discussion,
> change the number here too. If you delete this page, delete the
> `Privacy | /privacy/` line from the footer menu as well, so nothing links to
> it.

This page says what this site stores about you, where it keeps it, how long it
keeps it, and who else sees it.

## Reading the site

This site sets no cookies on your browser while you read it, and it runs no
analytics or advertising scripts. Its fonts, styles and scripts come from this
site, not from another server.

Pictures of other people, such as the avatar of somebody who replied from
another site, are fetched and stored by this site and served from here. Your
browser does not fetch them from the other server, so that server does not
learn your IP address.

When you follow a link from this site to another one, your browser tells that
site only which site you came from, not which page.

To slow down abuse, the site counts requests from each IP address for a few
minutes. The counts are kept in memory only, and they are lost when the site
restarts. The web server writes a log line for each request. By default the
line does not contain your IP address. The owner can turn that on, and whoever
hosts the site can keep its own logs.

## Comments

When you leave a comment, the site stores:

- Your name, your website and the words you type. These are shown on the page
  beside your comment, for as long as the comment is up.
- Your email address, if you give one. It is optional, it is never shown, and
  it is used to decide whether your comment needs a moderator and to email you
  about replies if you ask for that. The site deletes it after 180 days.
- A salted hash of your IP address, which lets the site spot a run of spam from
  one place. The IP address itself is never stored. The site deletes the hash
  after 30 days.

If this site can send mail, a new comment waiting for a moderator is emailed
to the people who moderate it.

Comments are stored as files beside the posts, and the site may keep those
files in version control. A copy deleted from the site can stay in that
history until the owner rewrites it.

**Reply emails (optional).** If this site can send mail and you tick "email me
when somebody replies", the site emails you when a reply to your comment is
approved. Each message has an unsubscribe link. If you unsubscribe, the site
keeps your address on a list of addresses it must not email about replies.
The mail provider the owner chose sees each address a message goes to.

## The contact form (optional)

If this site has a contact form and you send a message, the site stores your
name, your email address, the subject, the message and a salted hash of your
IP address, in a private file that is not published. If the site can send
mail, it also emails the message to the owner, through the mail provider the
owner chose. The site deletes the message after 365 days, and the hash after 30
days.

## Spam checking with Akismet (optional)

Only if the owner turns it on, the site sends each new comment, webmention and
contact message to Akismet, a spam-checking service run by Automattic. Akismet
receives your IP address, your browser's user agent, the page you came from,
your name, email address and website, and what you wrote. Akismet's own privacy
policy covers what it does with them.

## Replies from other sites

**Webmentions.** When another site links to a post here and sends a
webmention, this site fetches that page and stores its author's name, website
and avatar address and the words of the page, and may show them as a comment.
They are a copy of a page that is already public. When a post here links to
another site, this site sends that site a webmention, which tells it only the
address of the post.

**The fediverse.** Posts here are published over ActivityPub, so they are
copied to the servers of the people who follow this site, on Mastodon and
similar services. If you follow this site from one of those services, the site
stores your public profile: your handle, display name, avatar address and
profile address, until you unfollow. That list is kept in the site's files
beside the posts. When you reply to, like, boost or quote a
post, the site stores the activity and who sent it, and may show replies under
the post.

## Accounts

The people who write this site have accounts. The site stores each account's
username, email address, a hash of its password and its public profile. A
signed-in account gets one cookie, `__Host-geekity_session` (called
`geekity_session` on a site without https), which holds a random session id and
nothing else. It is deleted when the person signs out or the session expires.

## How long the site keeps things

| What                                             | How long           |
| ------------------------------------------------ | ------------------ |
| The email address on a comment                   | 180 days           |
| The hash of the IP address on a comment or message | 30 days          |
| A contact message                                | 365 days           |
| Everything else above                            | Until it is deleted |

The site checks these periods when it starts and every six hours after that.

## Asking for your data to be removed

Write to the owner of this site. The owner can find every comment and contact
message that carries your email address and erase them together, on
Tools > Personal data: your comments stay in their threads signed "Anonymous",
without your email, website or address hash, your messages are deleted, and
your address comes off the list of addresses not to email about replies.
Comments left without an email address, webmentions and fediverse replies are
removed one at a time.

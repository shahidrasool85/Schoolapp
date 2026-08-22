# Embedding public admissions forms

Use a same-origin **iframe**. Do not add a JavaScript SDK in this phase.

## 1. Publish the form

In School Admin → Admissions → Forms, publish the form. Unpublished or expired forms fail closed for public visitors.

## 2. Copy the embed code

The share panel provides HTML similar to:

```html
<iframe
  src="https://greenwood.example.com/admissions/embed/enquiry/year-3-enquiry"
  title="Greenwood Academy enquiry form"
  style="width:100%;max-width:780px;min-height:760px;border:0;border-radius:8px;"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
></iframe>
```

For applications, the path is `/admissions/embed/apply/{slug}`.

## 3. Website requirements

- The iframe `src` must be the school hostname (subdomain or verified custom domain). Do not point it at the platform apex.
- Typical school CMS pages can host the iframe. Submission uses the iframe document origin, not third-party cookies.
- Make the iframe responsive (`width: 100%`). Increase `min-height` if the application has many steps.
- Optional campaign tracking: append `?source=school-website` (or another campaign code created in Sources / Campaigns).

## 4. What not to do

- Do not embed School Admin URLs (`/school/...`).
- Do not put organisation IDs, API tokens, or applicant data in the iframe URL.
- Do not rely on `X-Organisation-Id` from the parent page.

## 5. Content security

The embed route sends `Content-Security-Policy: frame-ancestors *` so a school website on another hostname can frame it. The non-embed public pages remain the shareable full-page form.

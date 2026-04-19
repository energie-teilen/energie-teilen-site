# Energie Teilen – GitHub and Vercel deployment guide

This package contains the final frontend source for the **Energie Teilen** website.

## What is already done

The website is already prepared as a professional static frontend with German content, tailored branding, a custom header and footer, and generated visual assets already referenced through public asset URLs inside the codebase.

## Upload to GitHub from your desktop

Create or open the target repository under the `energie-teilen` organization, then upload the full contents of this ZIP so the repository root contains files such as `package.json`, `client/`, `server/`, and `shared/`.

If GitHub shows old files in the repository, remove them before uploading this package so the repository contains only the latest website version.

## Deploy on Vercel

Open Vercel and import the GitHub repository from the `energie-teilen` organization.

Use the following settings if Vercel does not detect them automatically:

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Build Command | `pnpm build` |
| Output Directory | `dist/public` |
| Install Command | `pnpm install` |

After the first deployment, verify that the homepage loads correctly and that all section anchors, buttons, and external asset images render as expected.

## Notes on assets

The website already points to hosted image URLs, so no separate image upload step is required for the code to render correctly.

## Recommended repository naming

A clean repository name such as `energie-teilen-site` is appropriate for consistency between GitHub and Vercel.

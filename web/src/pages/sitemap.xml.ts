import type { APIRoute } from 'astro';

// The pages of the site; 404 is left out.
const PAGES = ['', 'overview/', 'app/', 'writes/', 'changelog/', 'benchmark/'];

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const urls = PAGES.map((p) => `<url><loc>${new URL(`${base}${p}`, site).href}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml' } });
};

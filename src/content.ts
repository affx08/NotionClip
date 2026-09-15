import browser from "webextension-polyfill";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

// Helper to flatten and find schema.org entities
function extractSchemas() {
  const schemas: Record<string, any> = {};
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  
  scripts.forEach(script => {
    try {
      const data = JSON.parse(script.textContent || "{}");
      // Handle both array of schemas and single schema
      const items = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
      
      items.forEach((item: any) => {
        if (item && item['@type']) {
          const typeStr = Array.isArray(item['@type']) ? item['@type'][0] : item['@type'];
          // Overwrite if multiple exist, or we could array it. For simplicity, overwrite.
          schemas[typeStr] = { ...schemas[typeStr], ...item };
        }
      });
    } catch (e) {
      console.warn("Obbi: Failed to parse a JSON-LD script", e);
    }
  });
  return schemas;
}

function extractMetaTags() {
  const meta: { property: Record<string, string>, name: Record<string, string> } = { property: {}, name: {} };
  document.querySelectorAll('meta').forEach(el => {
    const prop = el.getAttribute('property');
    const name = el.getAttribute('name');
    const content = el.getAttribute('content');
    
    if (prop && content) meta.property[prop] = content;
    if (name && content) meta.name[name] = content;
  });
  return meta;
}

// @ts-expect-error - webextension-polyfill supports returning a Promise
browser.runtime.onMessage.addListener((request: any, _sender, _sendResponse) => {
  if (request.action === "parse_article_fast") {
    const metaTags = extractMetaTags();
    const urlObj = new URL(window.location.href);
    const domain = urlObj.hostname;
    
    const imgUrls = new Set<string>();

    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (ogImage && ogImage.startsWith('http')) imgUrls.add(ogImage);
    const twImage = document.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
    if (twImage && twImage.startsWith('http')) imgUrls.add(twImage);

    Array.from(document.images).forEach(img => {
      const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
      if (src && src.startsWith('http')) {
        if (img.width > 20 || img.height > 20 || (!img.width && !img.height)) {
          imgUrls.add(src);
        }
      }
    });

    document.querySelectorAll('source').forEach(source => {
      const srcset = source.srcset || source.getAttribute('data-srcset');
      if (srcset) {
        const firstUrl = srcset.split(',')[0].trim().split(' ')[0];
        if (firstUrl.startsWith('http')) imgUrls.add(firstUrl);
      }
    });

    const allImages = Array.from(imgUrls).slice(0, 50);
    
    const dictionary = {
      url: window.location.href,
      title: document.title,
      markdown: "Extracting markdown...", // placeholder
      meta: metaTags,
      schema: extractSchemas(),
      image: document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "",
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") || document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "",
      author: document.querySelector('meta[name="author"]')?.getAttribute("content") || document.querySelector('meta[property="article:author"]')?.getAttribute("content") || "",
      domain: domain,
      favicon: document.querySelector('link[rel="icon"]')?.getAttribute("href") || document.querySelector('link[rel="shortcut icon"]')?.getAttribute("href") || `${urlObj.protocol}//${domain}/favicon.ico`,
      published: document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") || "",
      site: document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") || domain,
      time: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
      allImages: allImages
    };

    return Promise.resolve(dictionary);
  }

  if (request.action === "parse_article_markdown") {
    let markdown = "";
    try {
      const documentClone = document.cloneNode(true) as Document;
      const reader = new Readability(documentClone);
      const article = reader.parse();
      if (article && article.content) {
        const turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
        markdown = turndownService.turndown(article.content);
      }
    } catch (e) {
      console.warn("Readability failed", e);
    }
    return Promise.resolve({ markdown });
  }
  
  if (request.action === "activate_image_picker") {
    const highlightBox = document.createElement('div');
    highlightBox.style.position = 'fixed';
    highlightBox.style.border = '3px solid #a855f7';
    highlightBox.style.backgroundColor = 'rgba(168, 85, 247, 0.2)';
    highlightBox.style.pointerEvents = 'none';
    highlightBox.style.zIndex = '999998';
    highlightBox.style.transition = 'all 0.1s ease';
    highlightBox.style.display = 'none';
    document.body.appendChild(highlightBox);

    let lastSrc: string | null = null;
    const originalCursor = document.body.style.cursor;

    const handleMouseMove = (e: MouseEvent) => {
      // Temporarily hide highlightBox so it doesn't block elementsFromPoint
      highlightBox.style.display = 'none';
      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      
      let foundSrc: string | null = null;
      let foundRect: DOMRect | null = null;

      for (const el of elements) {
        // Skip the highlight box just in case
        if (el === highlightBox) continue;

        if (el.tagName === 'IMG') {
          foundSrc = (el as HTMLImageElement).src;
          foundRect = el.getBoundingClientRect();
          break;
        } else {
          // Check for background image
          const style = window.getComputedStyle(el);
          if (style.backgroundImage && style.backgroundImage !== 'none' && style.backgroundImage.includes('url(')) {
            const match = style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
            if (match && match[1]) {
              foundSrc = match[1];
              // Some overlays cover the whole screen, making the highlight box huge.
              // If it's too big, we still grab the image but maybe don't highlight the whole screen.
              foundRect = el.getBoundingClientRect();
              break;
            }
          }
        }
      }

      if (foundSrc && foundRect) {
        lastSrc = foundSrc;
        highlightBox.style.display = 'block';
        highlightBox.style.top = `${foundRect.top}px`;
        highlightBox.style.left = `${foundRect.left}px`;
        highlightBox.style.width = `${foundRect.width}px`;
        highlightBox.style.height = `${foundRect.height}px`;
      } else {
        lastSrc = null;
        highlightBox.style.display = 'none';
      }
    };

    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      cleanup();
      
      if (lastSrc) {
        // Send back to storage so the popup can read it when reopened
        browser.storage.local.set({ 
          notion_picker_result: lastSrc,
          notion_picker_active: false 
        }).then(() => {
          // Show toast on page
          const toast = document.createElement('div');
          toast.textContent = "Image Captured! Open the Notion Clipper to finish saving.";
          toast.style.position = 'fixed';
          toast.style.bottom = '20px';
          toast.style.right = '20px';
          toast.style.background = '#252526';
          toast.style.color = '#fff';
          toast.style.padding = '12px 24px';
          toast.style.borderRadius = '8px';
          toast.style.borderLeft = '4px solid #a855f7';
          toast.style.zIndex = '9999999';
          toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
          toast.style.fontFamily = 'sans-serif';
          document.body.appendChild(toast);
          
          setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.5s';
            setTimeout(() => toast.remove(), 500);
          }, 4000);
        });
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
      }
    };

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      highlightBox.remove();
      document.body.style.cursor = originalCursor;
    };

    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.body.style.cursor = 'crosshair';

    return Promise.resolve(true);
  }

  return Promise.resolve(null);
});

import { markdownToBlocks } from "@jxpeng98/martian";

/**
 * Converts a raw Markdown string into an array of Notion Block objects.
 * This utilizes the Martian parser which handles headings, paragraphs,
 * lists, code blocks, and rich text formatting perfectly for Notion's API.
 * 
 * @param markdown - The raw markdown string extracted via Turndown.
 * @returns Array of Notion Block objects ready to be sent in POST /v1/pages.
 */
export function parseMarkdownToNotionBlocks(markdown: string) {
  try {
    // The library converts the string into the exact JSON array expected by Notion
    const blocks = markdownToBlocks(markdown);
    return blocks;
  } catch (error) {
    console.error("Failed to parse markdown into Notion blocks:", error);
    // Fallback: return a single paragraph block if parsing fails
    return [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: "Failed to parse article content correctly. The original markdown was too complex."
              }
            }
          ]
        }
      }
    ];
  }
}

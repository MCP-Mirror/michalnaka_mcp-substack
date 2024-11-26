#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// Debug utility function with force flush
function debug(message, ...args) {
    const timestamp = new Date().toISOString();
    process.stderr.write(`[${timestamp}] DEBUG: ${message} ${args.map(a => JSON.stringify(a)).join(' ')}\n`);
}

debug('Starting MCP Substack server...');

// URL validation function
function validateUrl(url) {
    try {
        const parsed = new URL(url);
        
        // Known Substack patterns:
        // 1. *.substack.com
        // 2. Custom domains that use Substack's structure
        const isValidUrl = (
            parsed.hostname.endsWith('.substack.com') ||
            /^\/p\/[\w-]+/.test(parsed.pathname)
        );

        if (!isValidUrl) {
            debug('Invalid URL structure:', url);
            return false;
        }

        return true;
    } catch (e) {
        debug('URL parsing error:', e);
        return false;
    }
}

const server = new Server({
    name: "mcp-substack",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "download_substack",
                description: "Download and parse content from a Substack post",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: { type: "string", description: "URL of the Substack post" },
                    },
                    required: ["url"],
                },
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    debug('Received request:', request.params);
    if (request.params.name !== "download_substack") {
        debug('Unknown tool requested:', request.params.name);
        throw new Error(`Unknown tool: ${request.params.name}`);
    }

    try {
        const { url } = request.params.arguments;
        
        if (!validateUrl(url)) {
            return {
                content: [{
                    type: "text",
                    text: "Invalid URL format. Please provide a valid Substack post URL. This could be either a substack.com domain or a custom domain with a Substack post structure."
                }],
                isError: true
            };
        }

        debug('Processing URL:', url);
        
        const response = await fetch(url);
        debug('Fetch response status:', response.status);
        
        const html = await response.text();
        debug('Received HTML length:', html.length);
        
        const $ = cheerio.load(html);
        
        // Check for Substack markers
        const hasSubstackMarkers = (
            $('meta[content*="substack"]').length > 0 ||
            $('script[src*="substack"]').length > 0 ||
            $('.post-content').length > 0 ||
            $('.subscriber-only').length > 0
        );

        if (!hasSubstackMarkers) {
            debug('No Substack markers found in page');
            return {
                content: [{
                    type: "text",
                    text: "This URL doesn't appear to be a Substack post. Please ensure you're providing a valid Substack article URL."
                }],
                isError: true
            };
        }
        
        const title = $('h1').first().text().trim() || $('h1.post-title').text().trim();
        debug('Found title:', title);
        
        const subtitle = $('.subtitle').text().trim();
        const author = $('.author-name').text().trim() || $('a.subscriber-only').text().trim();
        debug('Found author:', author);
        
        let content = '';
        $('.post-content, article, .body').find('p, h2, h3').each((i, el) => {
            content += $(el).text().trim() + '\n\n';
        });
        debug('Extracted content length:', content.length);

        if (!content) {
            debug('No content found - might be subscriber-only');
            return {
                content: [
                    {
                        type: "text",
                        text: "This appears to be a subscriber-only post. I cannot access the full content.",
                    }
                ],
                isError: true,
            };
        }

        debug('Successfully processed article');
        return {
            content: [
                {
                    type: "text",
                    text: `Title: ${title}\nAuthor: ${author}\nSubtitle: ${subtitle}\n\n${content}`,
                },
            ],
        };
    } catch (err) {
        debug('Error processing request:', err);
        return {
            content: [
                {
                    type: "text",
                    text: `Error processing Substack post: ${err}`,
                },
            ],
            isError: true,
        };
    }
});

debug('Setting up server connection...');
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

debug('Starting server...');
runServer().catch((error) => {
    debug('Server error:', error);
    console.error(error);
});

// Handle process events
process.on('uncaughtException', (error) => {
    debug('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    debug('Unhandled rejection:', error);
});

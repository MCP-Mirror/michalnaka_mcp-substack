#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enhanced debug logging
function debug(message, ...args) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] DEBUG: ${message} ${args.map(a => 
        typeof a === 'object' ? JSON.stringify(a, null, 2) : a
    ).join(' ')}\n`;
    
    // Log to stderr for immediate feedback
    process.stderr.write(logMessage);
    
    // Log to file
    const logPath = path.join(process.env.HOME, 'mcp-substack-debug.log');
    fs.appendFileSync(logPath, logMessage);
}

// Enhanced URL validation
function validateUrl(url) {
    try {
        const parsed = new URL(url);
        debug('Validating URL:', {
            hostname: parsed.hostname,
            pathname: parsed.pathname,
            fullUrl: url
        });
        
        const isValidUrl = (
            parsed.hostname.endsWith('.substack.com') ||
            /^\/p\/[\w-]+/.test(parsed.pathname)
        );

        debug('URL validation result:', {
            isValid: isValidUrl,
            matchedPattern: parsed.hostname.endsWith('.substack.com') ? 'substack.com domain' : 'custom domain'
        });

        return isValidUrl;
    } catch (e) {
        debug('URL validation error:', e.message);
        return false;
    }
}

// Initialize server
debug('Starting MCP Substack server...');

const server = new Server({
    name: "mcp-substack",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    debug('Listing available tools');
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
    debug('========= New Request =========');
    debug('Received request:', request.params);

    if (request.params.name !== "download_substack") {
        debug('Unknown tool requested:', request.params.name);
        throw new Error(`Unknown tool: ${request.params.name}`);
    }

    try {
        const { url } = request.params.arguments;
        debug('Processing URL:', url);
        
        if (!validateUrl(url)) {
            debug('URL validation failed');
            return {
                content: [{
                    type: "text",
                    text: "Invalid URL format. Please provide a valid Substack post URL."
                }],
                isError: true
            };
        }

        debug('Fetching content...');
        const response = await fetch(url);
        debug('Fetch response:', {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers)
        });
        
        const html = await response.text();
        debug('Received HTML length:', html.length);
        
        const $ = cheerio.load(html);
        
        // Check for Substack markers
        const markers = {
            meta: $('meta[content*="substack"]').length,
            script: $('script[src*="substack"]').length,
            postContent: $('.post-content').length,
            subscriberOnly: $('.subscriber-only').length
        };
        
        debug('Substack markers found:', markers);

        if (Object.values(markers).every(count => count === 0)) {
            debug('No Substack markers found in page');
            return {
                content: [{
                    type: "text",
                    text: "This URL doesn't appear to be a Substack post."
                }],
                isError: true
            };
        }
        
        const title = $('h1').first().text().trim() || $('h1.post-title').text().trim();
        const subtitle = $('.subtitle').text().trim();
        const author = $('.author-name').text().trim() || $('a.subscriber-only').text().trim();
        
        debug('Extracted metadata:', { title, subtitle, author });
        
        let content = '';
        $('.post-content, article, .body').find('p, h2, h3').each((i, el) => {
            content += $(el).text().trim() + '\n\n';
        });
        
        debug('Content extraction:', {
            extractedLength: content.length,
            firstChars: content.substring(0, 100) + '...'
        });

        if (!content) {
            debug('No content found - might be subscriber-only');
            return {
                content: [{
                    type: "text",
                    text: "This appears to be a subscriber-only post. I cannot access the full content."
                }],
                isError: true
            };
        }

        debug('Successfully processed article');
        return {
            content: [{
                type: "text",
                text: `Title: ${title}\nAuthor: ${author}\nSubtitle: ${subtitle}\n\n${content}`
            }]
        };

    } catch (err) {
        debug('Error processing request:', {
            error: err.message,
            stack: err.stack
        });
        return {
            content: [{
                type: "text",
                text: `Error processing Substack post: ${err.message}`
            }],
            isError: true
        };
    }
});

debug('Setting up server connection...');

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    debug('Server connected and ready');
}

process.on('uncaughtException', (error) => {
    debug('Uncaught exception:', {
        error: error.message,
        stack: error.stack
    });
});

process.on('unhandledRejection', (error) => {
    debug('Unhandled rejection:', {
        error: error.message,
        stack: error.stack
    });
});

debug('Starting server...');
runServer().catch((error) => {
    debug('Server startup error:', {
        error: error.message,
        stack: error.stack
    });
});
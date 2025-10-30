import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppContext } from '../types';

// Create OpenAPI app
const openapi = new OpenAPIHono<AppContext>();

// Define specific response schemas for each endpoint
const AuthMessageResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    message: z.string(),
    timestamp: z.number(),
  }),
});

const AuthVerifyResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    token: z.string(),
    address: z.string(),
    role: z.string(),
    expiresIn: z.number(),
  }),
});

const HealthResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    healthy: z.boolean(),
    checks: z.object({
      database: z.boolean(),
      webhookSecret: z.boolean(),
      jwtSecret: z.boolean(),
    }),
  }),
});

const TriggerResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    message: z.string(),
    results: z.object({
      symbolsProcessed: z.number(),
      alertsTriggered: z.number(),
    }),
  }),
});

const UserProfileResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.number(),
    address: z.string(),
    nickname: z.string(),
    avatar_url: z.string(),
    role: z.string(),
    preferences: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
});

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional(),
  }),
});

const ScheduledErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional(),
  }),
});

const AddressQuerySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
});

const VerifyRequestSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/, "Invalid signature format"),
});

const TriggerSymbolsSchema = z.object({
  symbols: z.array(z.string()).min(1).optional(),
});

// Configure OpenAPI documentation
openapi.doc('/doc', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Market Alert API',
    description: `A comprehensive cryptocurrency market monitoring and alerting system built with Hono and Cloudflare Workers.

## Features
- **Real-time Market Monitoring**: Track cryptocurrency price changes across multiple symbols
- **Smart Alerts**: Configurable thresholds and cooldown periods to prevent alert fatigue
- **Ethereum Authentication**: Secure authentication using Ethereum wallet signatures
- **User Management**: Profile management with customizable preferences
- **Admin Panel**: Comprehensive administration interface for system management
- **Webhook Integration**: Flexible alert delivery via customizable webhooks

## Authentication
This API uses Ethereum-based authentication. Users sign a message with their private key to prove ownership of their wallet address.

1. **Get Sign Message**: Call \`GET /auth/message?address=YOUR_WALLET_ADDRESS\`
2. **Sign Message**: Sign the received message with your wallet
3. **Verify Signature**: Call \`POST /auth/verify\` with your address and signature
4. **Use Token**: Include the received JWT token in the \`Authorization\` header as \`Bearer TOKEN\`

## Rate Limiting
- Authentication endpoints: 10 requests per minute
- Trigger endpoints: 5 requests per minute
- Other endpoints: 100 requests per minute

## Error Handling
All errors follow a consistent format:
\`\`\`json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": "Additional error details (optional)"
  }
}
\`\`\`

## Pagination
List endpoints support pagination using these parameters:
- \`page\`: Page number (default: 1)
- \`pageSize\`: Items per page, max 100 (default: 20)`,
    contact: {
      name: 'Market Alert Support',
      email: 'support@example.com',
    },
  },
  servers: [
    {
      url: 'https://market-alert-api.nevend.workers.dev',
      description: 'Production server',
    },
    {
      url: 'http://localhost:8787',
      description: 'Development server',
    },
  ],
  tags: [
    {
      name: 'Authentication',
      description: 'Ethereum wallet-based authentication endpoints',
    },
    {
      name: 'Users',
      description: 'User profile management endpoints',
    },
    {
      name: 'Admin',
      description: 'Administrative endpoints for system management',
    },
    {
      name: 'Health',
      description: 'System health check endpoints',
    },
    {
      name: 'Trigger',
      description: 'Manual trigger endpoints for market monitoring',
    },
  ],
});

// Health check endpoint
const healthRoute = createRoute({
  method: 'get',
  path: '/healthz',
  tags: ['Health'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
      description: 'Health check successful',
    },
  },
});

openapi.openapi(healthRoute, (c) => {
  return c.json({
    success: true,
    data: {
      healthy: true,
      checks: {
        database: true,
        webhookSecret: true,
        jwtSecret: true,
      },
    },
  });
});

// Get sign message endpoint
const getMessageRoute = createRoute({
  method: 'get',
  path: '/auth/message',
  tags: ['Authentication'],
  request: {
    query: AddressQuerySchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: AuthMessageResponseSchema,
        },
      },
      description: 'Sign message generated successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Bad request - invalid address',
    },
  },
});

openapi.openapi(getMessageRoute, (c) => {
  const { address } = c.req.valid('query');

  return c.json({
    success: true,
    data: {
      message: `Welcome to Market Alert! Please sign this message to authenticate.\n\nNonce: ${Date.now()}\nAddress: ${address}`,
      timestamp: Date.now(),
    },
  }, 200 as const);
});

// Verify signature endpoint
const verifyRoute = createRoute({
  method: 'post',
  path: '/auth/verify',
  tags: ['Authentication'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: VerifyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: AuthVerifyResponseSchema,
        },
      },
      description: 'Authentication successful',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Bad request - invalid parameters',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized - invalid signature',
    },
  },
});

openapi.openapi(verifyRoute, (c) => {
  const { address } = c.req.valid('json');

  return c.json({
    success: true,
    data: {
      token: "sample_jwt_token_placeholder",
      address: address,
      role: "user",
      expiresIn: 86400,
    },
  }, 200 as const);
});

// Trigger endpoint
const triggerRoute = createRoute({
  method: 'post',
  path: '/trigger',
  tags: ['Trigger'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: TriggerSymbolsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: TriggerResponseSchema,
        },
      },
      description: 'Market monitoring triggered successfully',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized - authentication required',
    },
  },
});

openapi.openapi(triggerRoute, (c) => {
  return c.json({
    success: true,
    data: {
      message: "Market monitoring triggered successfully",
      results: {
        symbolsProcessed: 2,
        alertsTriggered: 1,
      },
    },
  }, 200 as const);
});

// Get user profile endpoint
const getProfileRoute = createRoute({
  method: 'get',
  path: '/users/profile',
  tags: ['Users'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: UserProfileResponseSchema,
        },
      },
      description: 'User profile retrieved successfully',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized - authentication required',
    },
  },
});

openapi.openapi(getProfileRoute, (c) => {
  return c.json({
    success: true,
    data: {
      id: 1,
      address: "0x742d35Cc6634C0532925a3b8D4C9db96C4b4Db45",
      nickname: "John Doe",
      avatar_url: "https://example.com/avatar.jpg",
      role: "user",
      preferences: "{\"theme\":\"dark\",\"notifications\":true}",
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    },
  }, 200 as const);
});

// Scheduled task trigger endpoint (for testing)
const scheduledRoute = createRoute({
  method: 'post',
  path: '/admin/scheduled',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: TriggerResponseSchema,
        },
      },
      description: 'Scheduled task triggered successfully',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized - authentication required',
    },
    500: {
      content: {
        'application/json': {
          schema: ScheduledErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
});

openapi.openapi(scheduledRoute, async (c) => {
  try {
    // Import the runMonitor function
    const { runMonitor } = await import('../lib/monitor');
    const results = await runMonitor(c.env as any);

    return c.json({
      success: true,
      data: {
        message: "Scheduled task triggered successfully",
        results: {
          symbolsProcessed: results.length,
          alertsTriggered: results.filter(r => r.triggered).length,
        },
      },
    }, 200 as const);
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: "SCHEDULED_TASK_FAILED",
        message: "Failed to execute scheduled task",
        details: `${error}`,
      },
    }, 500 as const);
  }
});

// Add Swagger UI endpoint
openapi.get(
  '/swagger',
  swaggerUI({
    url: '/doc',
    title: 'Market Alert API Documentation',
  })
);

export default openapi;
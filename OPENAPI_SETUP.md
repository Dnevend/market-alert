# OpenAPI/Swagger Documentation Setup

This document explains how to use the OpenAPI/Swagger documentation system implemented for the Market Alert API.

## Overview

The Market Alert API now includes comprehensive OpenAPI 3.0 documentation with automatic schema generation from Zod validators and an interactive Swagger UI interface.

## Key Features

- **Automatic Schema Generation**: OpenAPI schemas are automatically generated from Zod validators
- **Interactive Documentation**: Swagger UI provides an interactive API explorer
- **Comprehensive Coverage**: All API endpoints are documented with request/response schemas
- **Authentication Support**: JWT authentication is documented with security schemes
- **Error Handling**: Standardized error response formats are documented
- **Type Safety**: Full TypeScript support with generated types

## Documentation Endpoints

### OpenAPI JSON Schema
- **URL**: `/doc`
- **Description**: Returns the complete OpenAPI 3.0 specification in JSON format
- **Usage**: Can be consumed by API clients, documentation generators, or testing tools

### Swagger UI
- **URL**: `/swagger`
- **Description**: Interactive API documentation interface
- **Features**:
  - Try out API endpoints directly from the browser
  - View request/response schemas
  - Authentication handling
  - Parameter validation
  - Example requests and responses

## Available Documentation

### API Categories

1. **Authentication** (`/auth/*`)
   - Ethereum wallet-based authentication
   - JWT token generation and validation
   - Authentication status checking

2. **Users** (`/users/*`)
   - User profile management
   - Profile updates and preferences

3. **Admin** (`/admin/*`)
   - Symbol management (CRUD operations)
   - System settings configuration
   - Alert history and management
   - Scheduled task triggering

4. **Health** (`/healthz`)
   - System health checks
   - Service availability monitoring

5. **Trigger** (`/trigger`)
   - Manual market monitoring triggers
   - Symbol-specific monitoring

### Schema Coverage

All API endpoints include:
- Request parameters (query, path, body)
- Request body schemas with validation
- Response schemas for all status codes
- Error response formats
- Authentication requirements
- Example values and descriptions

## Usage Examples

### Accessing Documentation

1. **Development Server**:
   ```bash
   # Start the development server
   pnpm run dev

   # Access Swagger UI
   open http://localhost:8787/swagger

   # Access OpenAPI JSON
   curl http://localhost:8787/doc
   ```

2. **Production**:
   ```bash
   # Access Swagger UI
   open https://your-worker.your-subdomain.workers.dev/swagger

   # Access OpenAPI JSON
   curl https://your-worker.your-subdomain.workers.dev/doc
   ```

### Using with API Clients

The OpenAPI specification can be used with various tools:

1. **OpenAPI Generator**:
   ```bash
   # Generate client SDKs
   npx @openapitools/openapi-generator-cli generate \
     -i https://your-worker.your-subdomain.workers.dev/doc \
     -g typescript-axios \
     -o ./generated-client
   ```

2. **Postman**:
   - Import the OpenAPI JSON specification
   - Automatically generates API collections

3. **Insomnia**:
   - Import OpenAPI specification
   - Generates request templates

## Implementation Details

### Core Components

1. **OpenAPI Schemas** (`src/lib/openapi-schemas.ts`)
   - Centralized schema definitions
   - Reusable common schemas
   - Type-safe Zod to OpenAPI conversion

2. **Route Definitions** (`src/routes/*-openapi.ts`)
   - OpenAPI-enabled route definitions
   - Automatic request/response validation
   - Comprehensive error handling

3. **Main Configuration** (`src/lib/openapi.ts`)
   - OpenAPI specification configuration
   - Swagger UI setup
   - Documentation metadata

### Dependencies

- `@hono/zod-openapi`: Hono OpenAPI integration
- `@hono/swagger-ui`: Swagger UI middleware
- `@asteasolutions/zod-to-openapi`: Zod to OpenAPI conversion
- `zod@4.x`: Schema validation

## Security Considerations

1. **Authentication**: All protected endpoints require JWT authentication
2. **CORS**: Documentation endpoints are accessible across origins
3. **Rate Limiting**: Consider implementing rate limiting for documentation endpoints
4. **Information Disclosure**: Ensure sensitive data is not exposed in documentation

## Customization

### Adding New Endpoints

1. Define Zod schemas in `src/lib/openapi-schemas.ts`
2. Create OpenAPI routes using `createRoute` from `@hono/zod-openapi`
3. Register routes in `src/lib/openapi.ts`

### Modifying Documentation

1. Update API metadata in `src/lib/openapi.ts`
2. Modify server URLs for different environments
3. Update contact information and descriptions

### Styling Swagger UI

The Swagger UI can be customized through the configuration options in `src/lib/openapi.ts`:

```typescript
openapi.get('/swagger', swaggerUI({
  url: '/doc',
  title: 'Market Alert API Documentation',
  // Additional customization options
}));
```

## Best Practices

1. **Schema Validation**: Always use Zod schemas for request/response validation
2. **Documentation Updates**: Keep documentation in sync with API changes
3. **Example Values**: Provide meaningful examples in schema definitions
4. **Error Documentation**: Document all possible error responses
5. **Version Management**: Update API version in documentation when making breaking changes

## Troubleshooting

### Common Issues

1. **Schema Generation Errors**:
   - Check Zod schema definitions
   - Ensure proper OpenAPI extensions are used
   - Verify schema registration

2. **Swagger UI Not Loading**:
   - Check OpenAPI JSON validity using linters
   - Verify CORS configuration
   - Check network connectivity

3. **Missing Schemas**:
   - Ensure all routes are registered in `src/lib/openapi.ts`
   - Check for proper import statements
   - Verify OpenAPI extensions in schema definitions

### Validation Tools

- [OpenAPI Lint](https://github.com/IBM/openapi-validator)
- [Swagger Editor](https://editor.swagger.io/)
- [Spectral](https://github.com/stoplightio/spectral)

## Future Enhancements

1. **Multi-version Support**: Support multiple API versions
2. **Code Generation**: Automatic client SDK generation
3. **Testing Integration**: Automated testing from OpenAPI specs
4. **Monitoring**: API usage analytics from documentation access
5. **Authentication Flow**: Enhanced authentication documentation

## Support

For questions or issues related to the OpenAPI documentation:

1. Check the implementation files in `src/lib/` and `src/routes/*-openapi.ts`
2. Review the official Hono OpenAPI documentation
3. Consult the OpenAPI 3.0 specification
4. Test endpoints using the Swagger UI interface
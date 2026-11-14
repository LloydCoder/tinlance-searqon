# Example API documentation

Use the Example API to retrieve service information.

## Authentication

Send a bearer token in the Authorization header. Tokens must be kept secret.

## Errors

The API returns HTTP 400 for invalid input and HTTP 429 when throttled.

## Rate limits

The default quota is 100 requests per minute.

## Versioning

The API is versioned and documents compatibility changes.

## Example

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.test/v1/health
```

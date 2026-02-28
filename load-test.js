import axios from 'axios';

const API_BASE = 'http://localhost:5000/api';

// Test endpoints that might consume memory or create recurring tasks
const endpoints = [
  {
    method: 'GET',
    url: `${API_BASE}/users`,
    name: 'GET /users'
  },
  {
    method: 'POST',
    url: `${API_BASE}/email/send-test`,
    name: 'POST /email/send-test',
    data: {
      to: 'test@example.com',
      subject: 'Test Email',
      text: 'This is a test email sent during load testing.'
    }
  },
  {
    method: 'GET',
    url: `${API_BASE}/items`,
    name: 'GET /items',
    headers: {
      'Authorization': 'Bearer test-token'
    }
  }
];

async function runLoadTest() {
  console.log('Starting load test...');
  console.log(`Duration: 60 seconds`);
  console.log(`Concurrent requests: 10 per second`);
  console.log('');

  const startTime = Date.now();
  const endTime = startTime + 60000; // Run for 60 seconds
  let requestCount = 0;
  let errorCount = 0;
  let successCount = 0;

  while (Date.now() < endTime) {
    const promises = [];

    // Send 10 concurrent requests per iteration
    for (let i = 0; i < 10; i++) {
      const endpoint = endpoints[i % endpoints.length];
      const promise = (async () => {
        try {
          if (endpoint.method === 'GET') {
            await axios.get(endpoint.url, { headers: endpoint.headers, timeout: 5000 });
          } else if (endpoint.method === 'POST') {
            await axios.post(endpoint.url, endpoint.data, { timeout: 5000 });
          }
          successCount++;
        } catch (error) {
          errorCount++;
          // Silently count errors; don't spam logs
        }
        requestCount++;
      })();
      promises.push(promise);
    }

    await Promise.all(promises);

    // Log progress every 10 seconds
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed % 10 === 0) {
      console.log(`[${elapsed}s] Requests: ${requestCount}, Success: ${successCount}, Errors: ${errorCount}`);
    }

    // Small delay between batches to avoid overwhelming
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log('');
  console.log('Load test completed!');
  console.log(`Total time: ${duration.toFixed(2)} seconds`);
  console.log(`Total requests: ${requestCount}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${errorCount}`);
  console.log(`Throughput: ${(requestCount / duration).toFixed(2)} requests/second`);

  process.exit(0);
}

runLoadTest().catch(err => {
  console.error('Load test error:', err);
  process.exit(1);
});

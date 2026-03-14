import { rateLimiter } from './emailSenders.js';

// simple demonstration: schedule five quick tasks and log timestamps
async function demo() {
  const start = Date.now();
  const tasks = [];
  for (let i = 1; i <= 5; i++) {
    tasks.push(
      rateLimiter.enqueue(async () => {
        const now = Date.now();
        console.log(`task ${i} executing at ${now - start}ms`);
        return i;
      })
    );
  }
  const results = await Promise.all(tasks);
  console.log('results', results);
}

demo().catch(console.error);

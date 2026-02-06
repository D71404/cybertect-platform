// test-db.ts
// 👇 Add .ts at the end of this string
import { testConnection } from './src/db/supabaseClient.ts'; 

(async () => {
  console.log('⏳ Starting connection test...');
  await testConnection();
})();
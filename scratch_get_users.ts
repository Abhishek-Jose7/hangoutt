import { db } from './src/lib/db/client';
import { users } from './src/lib/db/schema';

async function getUsers() {
  try {
    const allUsers = await db.select().from(users);
    console.log('=== Users ===');
    console.log(allUsers);
  } catch (err) {
    console.error('Error:', err);
  }
}

getUsers();

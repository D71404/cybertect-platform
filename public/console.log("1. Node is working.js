console.log("1. Node is working.");
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('System Operational'));

try {
    app.listen(3001, () => { // Note: Using Port 3001 to avoid conflicts
        console.log("2. Server started on Port 3001");
        console.log("3. If you see this, the problem is your viewer.js file.");
    });
} catch (e) {
    console.log("CRITICAL ERROR:", e.message);
}

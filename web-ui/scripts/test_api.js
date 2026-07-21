const fs = require('fs');
async function test() {
    try {
        // Find a recent STEP file
        const stepFile = fs.readFileSync('C:\\Projects\\vexcad backup\\web-ui\\public\\test_part.step'); 
    } catch(e) {}
}
test();

import express from "express";
import https from 'https'; // <-- Import HTTPS module
import fs from "fs"; // <-- fs is needed for reading cert files
import neo4j from "neo4j-driver";
import cors from "cors";
import path from "path";
import XLSX from "xlsx";
import { fileURLToPath } from "url";
import multer from 'multer';
import AdmZip from 'adm-zip';

const app = express();

// --- Configuration ---
const httpsPort = 443; // Standard HTTPS port (requires root/sudo or capabilities)
// Or use a non-standard port like 8443 if you don't have root access
// const httpsPort = 8443;

const domain = "backend.genframe-tool.com"; // Your domain name

// --- SSL Certificate Paths ---
// !!! IMPORTANT: Verify these paths are correct on your server !!!
const sslKeyPath = `/etc/letsencrypt/live/neo4j.genframe-tool.com/privkey.pem`;
const sslCertPath = `/etc/letsencrypt/live/neo4j.genframe-tool.com/fullchain.pem`;

app.use(cors());
app.use(express.json());

// Neo4j connection details
const uri = "neo4j+s://neo4j.genframe-tool.com:7687"; // Replace with your Neo4j URI
const user = "neo4j"; // Replace with your Neo4j username
const password = "rohanrohan"; // Replace with your Neo4j password

// Create a Neo4j driver instance
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);
//cypher-shell -a "neo4j+s://3.110.214.56:7687" -u neo4j -p rohanrohan --debug
// Neo4j queries
const tableToProgramsQuery = `
MATCH (p:Program)-[:INCLUDES]->(c:COPYBOOK {type: 'TABLE'})
WITH c.name AS tableName, collect(p.program_name) AS programList, count(p) AS programCount
RETURN tableName, programList, programCount
ORDER BY programCount ASC
`;

const programStatisticsQuery = `
MATCH (p:Program)
WITH
sum(p.total_loc) AS Total_LOC,
sum(p.commented_loc) AS Commented_Lines,
sum(p.blank_loc) AS Blank_line,
sum(p.code_loc) AS Code_LOC,
count(p) AS Program_Count,
collect(p.copybooks) AS all_copybooks
UNWIND all_copybooks AS copybook_list
UNWIND copybook_list AS copybook
RETURN
Total_LOC,
Commented_Lines,
Blank_line,
Code_LOC,
Program_Count,
count(DISTINCT copybook) AS Copybook_Count
`;

const jclToProgramQuery = `
MATCH (j:JCL)-[:JCL_CALLS]->(p:Program) 
RETURN j.name as JCL_name, collect(p.program_name) as Main_program
`;

const programWiseQuery = `
MATCH (p:Program) 
RETURN p.program_name as Program, 
p.called_programs as Nested_Pgm, 
p.subroutine_calls as Subroutine, 
p.copybooks as COPYBOOK,
p.input_output_files as Input_Output_File
`;

// Function to run the query and return results
async function runQuery(session, query) {
  const result = await session.run(query);
  return result.records.map((record) => record.toObject());
}

function getArtifactsData() {
  const filePath =
  path.resolve(__dirname, "sample_old.json");

  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        console.error("Error reading the file:", err);
        reject(err);
      } else {
        try {
          const allArtifactResults = JSON.parse(data);
          resolve(allArtifactResults);
        } catch (err) {
          console.error("Error parsing JSON:", err);
          reject(err);
        }
      }
    });
  });
}
// Connect to Neo4j and execute the queries
async function main() {
  const session = driver.session();

  try {
    const tableToProgramsResults = await runQuery(session, tableToProgramsQuery);
    const programStatisticsResults = await runQuery(session, programStatisticsQuery);
    const jclToProgramResults = await runQuery(session, jclToProgramQuery);
    const programWiseResults = await runQuery(session, programWiseQuery);

    // Convert results to worksheet format
    let previousTableName = "";
    const tableToProgramsData = [];
    tableToProgramsResults.forEach((record) => {
      const { tableName, programList, programCount } = record;

      tableToProgramsData.push({
        "Table Name": previousTableName == tableName ? "" : tableName,
        "Connected Program": programList.length > 0 ? programList[0] : "",
        "No. of Connected Program": programCount.low,
      });
      for (let i = 1; i < programList.length; i++) {
        tableToProgramsData.push({
          "Table Name": "",
          "Connected Program": programList[i],
          "No. of Connected Program": "",
        });
      }
      previousTableName = tableName;
    });

    // Create data for Excel sheets
    const programStatisticsData = programStatisticsResults.map((record) => ({
      "Total LOC": record.Total_LOC.low,
      "Commented Lines": record.Commented_Lines.low,
      "Blank line": record.Blank_line.low,
      "Code LOC": record.Code_LOC.low,
      "Program Count": record.Program_Count.low,
      "Copybook Count": record.Copybook_Count.low,
    }));

    let previousJCLName = "";
    const jclToProgramData = [];
    jclToProgramResults.forEach((record) => {
      const { JCL_name, Main_program } = record;

      jclToProgramData.push({
        "JCL name": previousJCLName == JCL_name ? "" : JCL_name,
        "Main Program": Main_program.length > 0 ? Main_program[0] : "",
      });
      for (let i = 1; i < Main_program.length; i++) {
        jclToProgramData.push({
          "JCL name": "",
          "Main Program": Main_program[i],
        });
      }
      previousJCLName = JCL_name;
    });

    let previousProgramName = "";
    const programWiseResultsData = [];
    programWiseResults.forEach((record) => {
      const { Program, Nested_Pgm, Subroutine, COPYBOOK, Input_Output_File } = record;
      const maxLength = Math.max(
        Nested_Pgm.length,
        Subroutine.length,
        COPYBOOK.length,
        Input_Output_File.length
      );

      programWiseResultsData.push({
        "Program Name": previousProgramName == Program ? "" : Program,
        "Called Program": Nested_Pgm.length > 0 ? Nested_Pgm[0] : "",
        Subroutines: Subroutine.length > 0 ? Subroutine[0] : "",
        Copybooks: COPYBOOK.length > 0 ? COPYBOOK[0] : "",
        "Input Output File": Input_Output_File.length > 0 ? Input_Output_File[0] : "",
      });
      for (let i = 1; i < maxLength; i++) {
        programWiseResultsData.push({
          "Program Name": "",
          "Called Program": Nested_Pgm[i] || "",
          Subroutines: Subroutine[i] || "",
          Copybooks: COPYBOOK[i] || "",
          "Input Output File": Input_Output_File[i] || "",
        });
      }
      previousProgramName = Program;
    });

    const allArtifactResults = await getArtifactsData();

    // console.log("The data is", allArtifactResults);

    return {
      tableToProgramsData,
      programStatisticsData,
      jclToProgramData,
      programWiseResultsData,
      allArtifactResults,
    };
  } finally {
    await session.close();
  }
}
//print hi statement
app.get("/", (req, res) => {
  res.send("Hi, Welcome to COBOL Utility API");
});

app.get("/report", async (req, res) => {
  // console.log("Report is triggered");
  try {
    const {
      tableToProgramsData,
      programStatisticsData,
      jclToProgramData,
      programWiseResultsData,
      allArtifactResults,
    } = await main();

    // Create a new workbook and add the data
    const workbook = XLSX.utils.book_new();

    // Add Table_to_Programs sheet
    const tableToProgramsSheet = XLSX.utils.json_to_sheet(tableToProgramsData);
    XLSX.utils.book_append_sheet(
      workbook,
      tableToProgramsSheet,
      "Table_to_Programs"
    );

    // Add Program_Statistics sheet
    const programStatisticsSheet = XLSX.utils.json_to_sheet(
      programStatisticsData
    );
    XLSX.utils.book_append_sheet(
      workbook,
      programStatisticsSheet,
      "Program_Statistics"
    );

    // Add JCL_to_program sheet
    const jclToProgramSheet = XLSX.utils.json_to_sheet(jclToProgramData);
    XLSX.utils.book_append_sheet(workbook, jclToProgramSheet, "JCL_to_program");

    // Add Program Analysis sheet
    const programWiseSheet = XLSX.utils.json_to_sheet(programWiseResultsData);
    XLSX.utils.book_append_sheet(
      workbook,
      programWiseSheet,
      "Program_Analysis"
    );

    // console.log("The json Data is", allArtifactResults);

    const allArtifactResultsSheet =
      XLSX.utils.json_to_sheet(allArtifactResults);
    XLSX.utils.book_append_sheet(
      workbook,
      allArtifactResultsSheet,
      "All Artifacts Analysis"
    );
    // console.log(
    //   "Excel file 'COBOL_Analysis.xlsx' has been created successfully."
    // );

    // Write the workbook to a buffer
    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    });

    // Set the response headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=COBOL_Analysis.xlsx"
    );

    // Send the buffer as the response
    res.send(excelBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Function to execute a query and return the result
async function getJclNodes() {
  const session = driver.session();
  try {
    const result = await session.run(`
        MATCH (j:JCL)-[:JCL_CALLS]->(p:Program) return j,p
        `);
    return result.records.map((record) => ({
      program: record.get("p").properties.program_name,
      jclnode: record.get("j").properties.name,
    }));
  } finally {
    await session.close();
  }
}

// Route to fetch PARA data based on program name
app.get("/jclNodes", async (req, res) => {
  try {
    const paraData = await getJclNodes();
    res.json(paraData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/allPrograms", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
            MATCH path = (start:Program)-[:INCLUDES*]->(called:COPYBOOK)
            RETURN nodes(path)
        `);
    console.log("The rsult ------",result)
    const programs = result.records.map((record) => {
      const nodes = record.get("nodes(path)");
      return nodes.map((node) => {
        return {
          program_name: node.properties.program_name,
          name: node.properties.name,
          type: node.properties.type,
          called_programs: node.properties.called_programs,
          subroutine_calls: node.properties.subroutine_calls,
        };
      });
    });
    console.log('The result of allPrograms',programs)
    res.json(programs);
  } finally {
    await session.close();
  }
});

// Route to save views
app.post("/save-views", (req, res) => {
  const views = req.body;
  // console.log("The req.body is", req);
  // console.log("The dirname", __dirname, "filename:", __filename);
  const filePath = path.resolve(__dirname, "Views.json");

  // Read the existing data from the file
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error reading views file");
    }

    let existingData = [];
    if (data) {
      existingData = JSON.parse(data);
    }

    // Filter out any views that already exist in the existing data
    const uniqueNewViews = views.filter((newView) => {
      return !existingData.some(
        (existingView) => existingView.id === newView.id
      );
    });

    // Append the unique new views to the existing data
    const updatedData = [...existingData, ...uniqueNewViews];

    // Write the updated data back to the file
    fs.writeFile(filePath, JSON.stringify(updatedData, null, 2), (err) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error saving views");
      }
      res.status(200).json(updatedData);
    });
  });
});

app.delete("/delete/:id", (req, res) => {
  const idToDelete = parseInt(req.params.id, 10);
  const filePath = path.resolve(__dirname, "Views.json");
  // console.log("The id is", idToDelete);
  // Read the existing data from the file
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error reading views file");
    }

    let existingData = [];
    if (data) {
      console.log("data", data);
      existingData = JSON.parse(data);
    }

    // Filter out the entry with the specified id
    const updatedData = existingData.filter((view) => view.id !== idToDelete);
    // console.log("The updatedData is", existingData, updatedData);
    // Write the updated data back to the file
    fs.writeFile(filePath, JSON.stringify(updatedData, null, 2), (err) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error deleting view");
      }
      res.status(200).json(updatedData);
    });
  });
});






// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' }); 

// Endpoint to handle file upload and extraction
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path; 
  const extractDir = path.join(__dirname, 'Uploads', req.file.originalname.replace('.zip', ''));

  // Create the extraction directory if it doesn't exist
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  // Extract the ZIP file
  try {
    const zip = new AdmZip(filePath);
    zip.extractAllTo(extractDir, true); // Extract all files to the specified directory

    // Clean up the uploaded file after extraction
    fs.unlinkSync(filePath);

    res.json({ message: 'File uploaded and extracted successfully', extractDir });
  } catch (error) {
    console.error('Error extracting the file:', error);
    res.status(500).json({ error: 'Failed to extract the file' });
  }
});


// Basic health check endpoint

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});



// --- Start the HTTPS Server ---
try {
  // Read the certificate files
  const options = {
    key: fs.readFileSync(sslKeyPath),
    cert: fs.readFileSync(sslCertPath)
  };

  // Create the HTTPS server
  const httpsServer = https.createServer(options, app);

  // Listen on the specified HTTPS port
  httpsServer.listen(httpsPort, () => {
    console.log(`✅ Secure Express server running at https://${domain}:${httpsPort}`);
    console.log(`   - Domain: ${domain}`);
    console.log(`   - Port: ${httpsPort}`);
    console.log(`   - SSL Key Path: ${sslKeyPath}`);
    console.log(`   - SSL Cert Path: ${sslCertPath}`);
    console.log(`   - Neo4j URI: ${uri}`);
  });

  // Optional: Graceful shutdown handling
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTPS server');
    httpsServer.close(() => {
        console.log('HTTPS server closed');
        driver.close().then(() => console.log('Neo4j driver closed')); // Close DB connection
        process.exit(0);
    });
  });

   process.on('SIGINT', () => {
     console.log('SIGINT signal received: closing HTTPS server');
     httpsServer.close(() => {
         console.log('HTTPS server closed');
         driver.close().then(() => console.log('Neo4j driver closed')); // Close DB connection
         process.exit(0);
     });
   });

} catch (error) {
  if (error.code === 'ENOENT') {
    console.error(`!!! ERROR: SSL certificate or key file not found.`);
    console.error(`    Checked Key Path: ${sslKeyPath}`);
    console.error(`    Checked Cert Path: ${sslCertPath}`);
    console.error(`    Please ensure the paths are correct and the files exist.`);
  } else if (error.code === 'EACCES') {
      console.error(`!!! ERROR: Permission denied reading SSL certificate or key file.`);
      console.error(`    Check file permissions for:`);
      console.error(`      ${sslKeyPath}`);
      console.error(`      ${sslCertPath}`);
  } else if (error.code === 'EADDRINUSE') {
       console.error(`!!! ERROR: Port ${httpsPort} is already in use.`);
       console.error(`    Another process might be running on this port.`);
  } else if (error.code === 'EACCES' && httpsPort < 1024) { // Specific check for low ports
       console.error(`!!! ERROR: Permission denied binding to port ${httpsPort}.`);
       console.error(`    Ports below 1024 require root privileges or special capabilities.`);
       console.error(`    Try running with 'sudo node your_script.js' or use a port >= 1024.`);
  }
  else {
    console.error('!!! Failed to start HTTPS server:', error);
  }
  process.exit(1); // Exit if server fails to start
}

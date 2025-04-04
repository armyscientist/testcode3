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
const sslKeyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;
const sslCertPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;

// --- Neo4j Connection Details ---
// Consider using environment variables for sensitive data like URIs and passwords
const uri = process.env.NEO4J_URI || "neo4j+s://neo4j.genframe-tool.com:7687"; // Replace with your Neo4j URI or use env var
const user = process.env.NEO4J_USER || "neo4j"; // Replace with your Neo4j username or use env var
const password = process.env.NEO4J_PASSWORD || "rohanrohan"; // Replace with your Neo4j password or use env var

if (!uri || !password) {
  console.error("!!! Neo4j URI and Password are required. Set NEO4J_URI and NEO4J_PASSWORD environment variables or update the script. !!!");
  // Optionally exit if configuration is missing
  // process.exit(1);
}

// --- Middleware ---
app.use(cors()); // Consider configuring CORS more restrictively for production
app.use(express.json());

// --- Neo4j Driver ---
let driver;
try {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    // Optional: Verify connectivity on startup
    driver.verifyConnectivity()
        .then(() => console.log('Neo4j Driver Connected'))
        .catch(error => {
            console.error('!!! Neo4j Driver Connection Error:', error);
            // Depending on your needs, you might want to exit if DB connection fails
            // process.exit(1);
        });
} catch (error) {
    console.error("!!! Failed to create Neo4j driver instance:", error);
    process.exit(1); // Exit if driver creation fails
}


// --- File Paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Neo4j Queries --- (Your queries remain unchanged)
const tableToProgramsQuery = `
MATCH (p:Program)-[:INCLUDES]->(c:COPYBOOK {type: 'TABLE'})
WITH c.name AS tableName, collect(p.program_name) AS programList, count(p) AS programCount
RETURN tableName, programList, programCount
ORDER BY programCount ASC
`;
// ... (keep all your other Neo4j queries: programStatisticsQuery, jclToProgramQuery, programWiseQuery) ...
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

// --- Helper Functions --- (Your functions remain largely unchanged)
async function runQuery(session, query) {
  const result = await session.run(query);
  return result.records.map((record) => record.toObject());
}

function getArtifactsData() {
  const filePath = path.resolve(__dirname, "sample_old.json");
  // Consider making the sample file path configurable
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        console.error("Error reading the artifacts file:", err);
        // Decide how to handle missing artifact file - reject or return empty data?
        reject(err);
      } else {
        try {
          const allArtifactResults = JSON.parse(data);
          resolve(allArtifactResults);
        } catch (err) {
          console.error("Error parsing artifact JSON:", err);
          reject(err);
        }
      }
    });
  });
}

async function mainReportLogic() { // Renamed from main to avoid confusion
  const session = driver.session();
  try {
    const [
        tableToProgramsResults,
        programStatisticsResults,
        jclToProgramResults,
        programWiseResults,
        allArtifactResults // Fetch artifacts data here as well
    ] = await Promise.all([
        runQuery(session, tableToProgramsQuery),
        runQuery(session, programStatisticsQuery),
        runQuery(session, jclToProgramQuery),
        runQuery(session, programWiseQuery),
        getArtifactsData().catch(err => { // Handle potential error from getArtifactsData
            console.error("Failed to get artifacts data:", err);
            return []; // Return empty array or default structure if artifacts fail
        })
    ]);


    // Convert results to worksheet format
    let previousTableName = "";
    const tableToProgramsData = [];
    tableToProgramsResults.forEach((record) => {
      const { tableName, programList, programCount } = record;

      tableToProgramsData.push({
        "Table Name": previousTableName == tableName ? "" : tableName,
        "Connected Program": programList.length > 0 ? programList[0] : "",
        "No. of Connected Program": programCount?.low ?? programCount, // Handle BigInt potential
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
        "Total LOC": record.Total_LOC?.low ?? record.Total_LOC,
        "Commented Lines": record.Commented_Lines?.low ?? record.Commented_Lines,
        "Blank line": record.Blank_line?.low ?? record.Blank_line,
        "Code LOC": record.Code_LOC?.low ?? record.Code_LOC,
        "Program Count": record.Program_Count?.low ?? record.Program_Count,
        "Copybook Count": record.Copybook_Count?.low ?? record.Copybook_Count,
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
        Nested_Pgm?.length ?? 0,
        Subroutine?.length ?? 0,
        COPYBOOK?.length ?? 0,
        Input_Output_File?.length ?? 0
      );

      programWiseResultsData.push({
        "Program Name": previousProgramName == Program ? "" : Program,
        "Called Program": Nested_Pgm?.length > 0 ? Nested_Pgm[0] : "",
        Subroutines: Subroutine?.length > 0 ? Subroutine[0] : "",
        Copybooks: COPYBOOK?.length > 0 ? COPYBOOK[0] : "",
        "Input Output File": Input_Output_File?.length > 0 ? Input_Output_File[0] : "",
      });
      for (let i = 1; i < maxLength; i++) {
        programWiseResultsData.push({
          "Program Name": "",
          "Called Program": Nested_Pgm?.[i] || "",
          Subroutines: Subroutine?.[i] || "",
          Copybooks: COPYBOOK?.[i] || "",
          "Input Output File": Input_Output_File?.[i] || "",
        });
      }
       if (Program) previousProgramName = Program; // Update only if Program exists
    });

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

// --- Routes ---

// Root path
app.get("/", (req, res) => {
  res.send("Hi, Welcome to COBOL Utility API (Secure)");
});

// Report generation
app.get("/report", async (req, res) => {
  console.log("Secure /report endpoint triggered");
  try {
    const reportData = await mainReportLogic(); // Use the renamed function

    // Create a new workbook and add the data
    const workbook = XLSX.utils.book_new();

    // Add sheets (ensure data exists before creating sheet)
    if (reportData.tableToProgramsData?.length > 0) {
        const tableToProgramsSheet = XLSX.utils.json_to_sheet(reportData.tableToProgramsData);
        XLSX.utils.book_append_sheet(workbook, tableToProgramsSheet, "Table_to_Programs");
    } else { console.log("No data for Table_to_Programs sheet."); }

    if (reportData.programStatisticsData?.length > 0) {
        const programStatisticsSheet = XLSX.utils.json_to_sheet(reportData.programStatisticsData);
        XLSX.utils.book_append_sheet(workbook, programStatisticsSheet, "Program_Statistics");
    } else { console.log("No data for Program_Statistics sheet."); }

    if (reportData.jclToProgramData?.length > 0) {
        const jclToProgramSheet = XLSX.utils.json_to_sheet(reportData.jclToProgramData);
        XLSX.utils.book_append_sheet(workbook, jclToProgramSheet, "JCL_to_program");
     } else { console.log("No data for JCL_to_program sheet."); }

    if (reportData.programWiseResultsData?.length > 0) {
        const programWiseSheet = XLSX.utils.json_to_sheet(reportData.programWiseResultsData);
        XLSX.utils.book_append_sheet(workbook, programWiseSheet, "Program_Analysis");
    } else { console.log("No data for Program_Analysis sheet."); }

    // Add All Artifacts Analysis sheet
    // Check if allArtifactResults is valid before creating the sheet
    if (Array.isArray(reportData.allArtifactResults) && reportData.allArtifactResults.length > 0) {
        const allArtifactResultsSheet = XLSX.utils.json_to_sheet(reportData.allArtifactResults);
        XLSX.utils.book_append_sheet(workbook, allArtifactResultsSheet, "All Artifacts Analysis");
    } else {
        console.log("No data for All Artifacts Analysis sheet.");
        // Optionally create an empty sheet or skip it
        // const emptySheet = XLSX.utils.json_to_sheet([{}]); // Example of empty sheet
        // XLSX.utils.book_append_sheet(workbook, emptySheet, "All Artifacts Analysis");
    }

    // Check if workbook has any sheets before sending
    if (workbook.SheetNames.length === 0) {
         console.log("No data generated for any sheets. Sending empty response or error.");
         // Decide response: send empty file, or error message?
         // Option 1: Send empty file (might confuse user)
         // const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
         // res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
         // res.setHeader('Content-Disposition', 'attachment; filename=COBOL_Analysis_Empty.xlsx');
         // return res.send(excelBuffer);

         // Option 2: Send error message
         return res.status(404).json({ message: "No data found to generate the report." });
    }


    // Write the workbook to a buffer
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

    // Set the response headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=COBOL_Analysis.xlsx"
    );

    console.log("Sending Excel report.");
    res.send(excelBuffer);

  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).json({ error: "Failed to generate report", details: error.message });
  }
});

// Fetch JCL Nodes
async function getJclNodes() { // Function kept as is
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

app.get("/jclNodes", async (req, res) => { // Route kept as is
  try {
    const jclData = await getJclNodes(); // Renamed variable for clarity
    res.json(jclData);
  } catch (error) {
    console.error("Error fetching JCL nodes:", error);
    res.status(500).json({ error: "Failed to fetch JCL nodes", details: error.message });
  }
});

// Fetch All Programs
app.get("/allPrograms", async (req, res) => { // Route kept as is
  const session = driver.session();
  try {
    // Consider adding LIMIT to prevent extremely large responses if the graph is huge
    const result = await session.run(`
            MATCH path = (start:Program)-[:INCLUDES*]->(called:COPYBOOK)
            RETURN nodes(path) LIMIT 1000
        `); // Added LIMIT 1000 as a safeguard

    const programs = result.records.map((record) => {
      const nodes = record.get("nodes(path)");
      return nodes.map((node) => {
        // Add null checks for properties
        return {
          program_name: node.properties?.program_name,
          name: node.properties?.name,
          type: node.properties?.type,
          called_programs: node.properties?.called_programs,
          subroutine_calls: node.properties?.subroutine_calls,
        };
      });
    });
    console.log('Fetched data for /allPrograms');
    res.json(programs);
  } catch(error) {
      console.error("Error fetching all programs:", error);
      res.status(500).json({ error: "Failed to fetch all programs", details: error.message });
  }
  finally {
    await session.close();
  }
});


// --- Views Endpoints --- (Kept as is, ensure Views.json path is correct)
const viewsFilePath = path.resolve(__dirname, "Views.json");

app.post("/save-views", (req, res) => {
  const views = req.body;
  if (!Array.isArray(views)) {
      return res.status(400).send("Invalid data format. Expected an array of views.");
  }

  // Basic validation for view structure (optional but recommended)
  // if (views.some(view => typeof view.id === 'undefined' || typeof view.name === 'undefined')) {
  //    return res.status(400).send("Invalid view structure. Each view must have at least an 'id'.");
  // }


  fs.readFile(viewsFilePath, "utf8", (err, data) => {
    let existingData = [];
    if (err && err.code !== 'ENOENT') { // Handle errors other than file not found
      console.error("Error reading views file:", err);
      return res.status(500).send("Error reading views file");
    } else if (!err) { // If file exists and was read
        try {
            existingData = JSON.parse(data);
            if (!Array.isArray(existingData)) { // Ensure existing data is an array
                 console.warn("Views.json does not contain a valid JSON array. Initializing as empty.");
                 existingData = [];
            }
        } catch (parseError) {
             console.error("Error parsing Views.json:", parseError);
             return res.status(500).send("Error parsing existing views data.");
        }
    } // If err.code === 'ENOENT', existingData remains []

    // Filter out any views that already exist in the existing data based on id
    const existingIds = new Set(existingData.map(view => view.id));
    const uniqueNewViews = views.filter(newView => !existingIds.has(newView.id));


    if (uniqueNewViews.length === 0) {
         console.log("No new unique views to add.");
         return res.status(200).json(existingData); // Return existing data if nothing new added
    }

    const updatedData = [...existingData, ...uniqueNewViews];

    fs.writeFile(viewsFilePath, JSON.stringify(updatedData, null, 2), (err) => {
      if (err) {
        console.error("Error writing views file:", err);
        return res.status(500).send("Error saving views");
      }
      console.log(`Saved ${uniqueNewViews.length} new view(s).`);
      res.status(200).json(updatedData);
    });
  });
});


app.delete("/delete/:id", (req, res) => {
  const idToDelete = req.params.id; // Keep as string or parse carefully if needed
  // const idToDelete = parseInt(req.params.id, 10); // Use this if IDs are strictly numbers

  // if (isNaN(idToDelete)) { // Add validation if parsing to int
  //   return res.status(400).send("Invalid ID format. ID must be a number.");
  // }


  fs.readFile(viewsFilePath, "utf8", (err, data) => {
    if (err) {
        if (err.code === 'ENOENT') { // File not found
             return res.status(404).send("Views file not found. Nothing to delete.");
        }
      console.error("Error reading views file:", err);
      return res.status(500).send("Error reading views file");
    }

    let existingData = [];
     try {
        existingData = JSON.parse(data);
         if (!Array.isArray(existingData)) {
             console.error("Views.json does not contain a valid JSON array.");
             return res.status(500).send("Invalid views file format.");
         }
     } catch (parseError) {
          console.error("Error parsing Views.json:", parseError);
          return res.status(500).send("Error parsing existing views data.");
     }

    const initialLength = existingData.length;
    // Filter out the entry with the specified id (compare as strings or numbers consistently)
    const updatedData = existingData.filter(view => String(view.id) !== String(idToDelete));

    if (updatedData.length === initialLength) {
        console.log(`View with ID ${idToDelete} not found for deletion.`);
        return res.status(404).send(`View with ID ${idToDelete} not found.`);
    }


    fs.writeFile(viewsFilePath, JSON.stringify(updatedData, null, 2), (err) => {
      if (err) {
        console.error("Error writing views file after deletion:", err);
        return res.status(500).send("Error deleting view");
      }
      console.log(`Successfully deleted view with ID ${idToDelete}.`);
      res.status(200).json(updatedData); // Send back the updated list
    });
  });
});


// --- File Upload Endpoint --- (Kept as is, ensure 'uploads/' dir exists or multer handles creation)
// Set up multer for file uploads
const uploadDir = path.join(__dirname, 'uploads');
// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir }); // Use resolved path

// Endpoint to handle file upload and extraction
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  // Sanitize original filename to prevent path traversal issues
  const safeOriginalName = path.basename(req.file.originalname).replace('.zip', '');
  const extractDir = path.join(__dirname, 'Uploads', safeOriginalName); // 'Uploads' directory for extracted files

  // Create the extraction directory if it doesn't exist
  try {
      if (!fs.existsSync(path.dirname(extractDir))) { // Ensure parent 'Uploads' dir exists
            fs.mkdirSync(path.dirname(extractDir), { recursive: true });
      }
      if (!fs.existsSync(extractDir)) {
           fs.mkdirSync(extractDir, { recursive: true });
      }
  } catch (mkdirError) {
       console.error('Error creating extraction directory:', mkdirError);
        // Clean up the uploaded temp file
       fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) console.error("Error deleting uploaded temp file:", unlinkErr);
        });
       return res.status(500).json({ error: 'Failed to create extraction directory' });
  }


  // Extract the ZIP file
  try {
    const zip = new AdmZip(filePath);
    zip.extractAllTo(extractDir, true); // Extract all files, overwrite existing

    console.log(`File extracted successfully to ${extractDir}`);
    res.json({ message: 'File uploaded and extracted successfully', extractDir });

  } catch (error) {
    console.error('Error extracting the file:', error);
    res.status(500).json({ error: 'Failed to extract the file' });
  } finally {
      // Clean up the uploaded temporary file from 'uploads/' directory
      fs.unlink(filePath, (err) => {
          if (err) {
              console.error("Error deleting uploaded temporary file:", err);
              // Log error but don't necessarily fail the request if extraction succeeded
          } else {
               console.log("Deleted uploaded temporary file:", filePath);
          }
      });
  }
});

// --- Basic health check endpoint ---
app.get("/health", (req, res) => {
  // Add checks for Neo4j connection if desired
  // driver.verifyConnectivity().then(...).catch(...)
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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

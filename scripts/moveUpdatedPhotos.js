/**
 * Move Updated Photos Script
 * 
 * Purpose: Move photos from Updated folder to production Provider Pictures folder
 * Overwrites existing photos and adds new ones
 * 
 * Author: System
 * Date: October 18, 2025
 */

const fs = require('fs').promises;
const path = require('path');

async function moveUpdatedPhotos() {
  try {
    console.log('📦 Moving updated provider photos to production location...\n');
    
    const sourceDir = path.join(__dirname, '../photos/Updated/Glowra Photo Repo V_10_18_25/Provider Pictures');
    const destDir = path.join(__dirname, '../photos/Provider Pictures');
    
    console.log(`Source: ${sourceDir}`);
    console.log(`Destination: ${destDir}\n`);
    
    // Ensure destination exists
    await fs.mkdir(destDir, { recursive: true });
    
    // Read source folders
    const folders = await fs.readdir(sourceDir);
    
    let foldersProcessed = 0;
    let filesAdded = 0;
    let filesUpdated = 0;
    let filesSkipped = 0;
    
    for (const folder of folders) {
      const sourceFolderPath = path.join(sourceDir, folder);
      const destFolderPath = path.join(destDir, folder);
      
      const stat = await fs.stat(sourceFolderPath);
      if (!stat.isDirectory()) continue;
      
      // Create destination folder if it doesn't exist
      await fs.mkdir(destFolderPath, { recursive: true });
      
      // Read files in source folder
      const files = await fs.readdir(sourceFolderPath);
      const photoFiles = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
      
      for (const file of photoFiles) {
        const sourceFilePath = path.join(sourceFolderPath, file);
        const destFilePath = path.join(destFolderPath, file);
        
        try {
          // Check if file exists in destination
          try {
            await fs.access(destFilePath);
            // File exists, will be updated
            await fs.copyFile(sourceFilePath, destFilePath);
            filesUpdated++;
          } catch {
            // File doesn't exist, will be added
            await fs.copyFile(sourceFilePath, destFilePath);
            filesAdded++;
          }
        } catch (error) {
          console.error(`Error copying ${folder}/${file}:`, error.message);
          filesSkipped++;
        }
      }
      
      foldersProcessed++;
      if (foldersProcessed % 10 === 0) {
        console.log(`Processed ${foldersProcessed} folders...`);
      }
    }
    
    console.log('\n✅ PHOTO MOVE COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log(`📁 Folders processed: ${foldersProcessed}`);
    console.log(`✅ Files added: ${filesAdded}`);
    console.log(`🔄 Files updated: ${filesUpdated}`);
    console.log(`⚠️  Files skipped: ${filesSkipped}`);
    console.log('\n🎉 All photos moved successfully!\n');
    
  } catch (error) {
    console.error('❌ Error moving photos:', error);
    throw error;
  }
}

// Run the move
if (require.main === module) {
  moveUpdatedPhotos()
    .then(() => {
      console.log('✅ Photo move completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Photo move failed:', error);
      process.exit(1);
    });
}

module.exports = { moveUpdatedPhotos };


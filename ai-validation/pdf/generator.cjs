/**
 * PDF Evidence Summary Generator
 * Generates deterministic one-page PDF from AI validation result
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate one-page PDF evidence summary
 * @param {object} aiValidation - AI validation result
 * @param {object} caseBrief - Original case brief
 * @param {string} outputPath - Path to save PDF
 * @returns {Promise<string>} - Path to generated PDF
 */
async function generateEvidencePDF(aiValidation, caseBrief, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      // Create PDF document (Letter size)
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: {
          top: 50,
          bottom: 50,
          left: 50,
          right: 50
        }
      });
      
      // Pipe to file
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      
      // Title
      doc.fontSize(20)
         .font('Helvetica-Bold')
         .text('AI Validation Evidence Summary', { align: 'center' });
      
      doc.moveDown(0.5);
      
      // Horizontal line
      doc.moveTo(50, doc.y)
         .lineTo(562, doc.y)
         .stroke();
      
      doc.moveDown(0.5);
      
      // Property and scan info
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .text('Property: ', { continued: true })
         .font('Helvetica')
         .text(caseBrief.site || 'Unknown');
      
      doc.font('Helvetica-Bold')
         .text('Scan Window: ', { continued: true })
         .font('Helvetica')
         .text(caseBrief.scan_window || 'Unknown');
      
      doc.font('Helvetica-Bold')
         .text('Total Events: ', { continued: true })
         .font('Helvetica')
         .text(caseBrief.total_events?.toString() || '0');
      
      doc.font('Helvetica-Bold')
         .text('Scan Timestamp: ', { continued: true })
         .font('Helvetica')
         .text(new Date(caseBrief.timestamp).toLocaleString());
      
      doc.moveDown(1);
      
      // Verdict box
      const verdictColor = {
        'FAIL': '#DC2626',
        'WARN': '#F59E0B',
        'PASS': '#10B981'
      }[aiValidation.verdict.label] || '#6B7280';
      
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .fillColor(verdictColor)
         .text(`VERDICT: ${aiValidation.verdict.label}`, { align: 'center' });
      
      doc.fontSize(12)
         .fillColor('#000000')
         .text(`Confidence: ${aiValidation.verdict.confidence}%`, { align: 'center' });
      
      doc.fontSize(9)
         .font('Helvetica')
         .fillColor('#4B5563')
         .text(aiValidation.verdict.rationale, {
           align: 'center',
           width: 462
         });
      
      doc.moveDown(1);
      doc.fillColor('#000000');
      
      // Key Indicators section
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Key Indicators:');
      
      doc.moveDown(0.3);
      
      // List top findings (max 6)
      const topFindings = aiValidation.findings.slice(0, 6);
      
      doc.fontSize(9)
         .font('Helvetica');
      
      if (topFindings.length === 0) {
        doc.text('• No significant findings detected', { indent: 10 });
      } else {
        topFindings.forEach((finding, index) => {
          const riskIcon = {
            'HIGH': '🔴',
            'MEDIUM': '🟡',
            'LOW': '🟢'
          }[finding.risk] || '⚪';
          
          doc.text(`${riskIcon} ${finding.title}`, { indent: 10 });
          doc.fontSize(8)
             .fillColor('#6B7280')
             .text(finding.mechanism, { indent: 20 });
          doc.fontSize(9)
             .fillColor('#000000');
          
          if (index < topFindings.length - 1) {
            doc.moveDown(0.3);
          }
        });
      }
      
      doc.moveDown(1);
      
      // Concrete Examples section
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Concrete Examples:');
      
      doc.moveDown(0.3);
      doc.fontSize(8)
         .font('Helvetica');
      
      let exampleCount = 0;
      const maxExamples = 5;
      
      // Collect examples from findings
      for (const finding of aiValidation.findings) {
        if (exampleCount >= maxExamples) break;
        
        if (finding.evidence && finding.evidence.examples && finding.evidence.examples.length > 0) {
          const examples = finding.evidence.examples.slice(0, Math.min(2, maxExamples - exampleCount));
          
          examples.forEach(example => {
            if (exampleCount >= maxExamples) return;
            
            if (example.iframeId) {
              doc.text(`• Iframe: ${example.iframeId}`, { indent: 10 });
              if (example.rect) {
                doc.fillColor('#6B7280')
                   .text(`  Dimensions: ${example.rect.width}x${example.rect.height} at (${example.rect.x}, ${example.rect.y})`, { indent: 15 });
                doc.fillColor('#000000');
              }
            } else if (example.endpoint) {
              doc.text(`• Endpoint: ${example.endpoint}`, { indent: 10 });
              if (example.count) {
                doc.fillColor('#6B7280')
                   .text(`  Count: ${example.count}`, { indent: 15 });
                doc.fillColor('#000000');
              }
            } else {
              // Generic example
              const exampleStr = JSON.stringify(example).substring(0, 100);
              doc.text(`• ${exampleStr}`, { indent: 10 });
            }
            
            exampleCount++;
            doc.moveDown(0.2);
          });
        }
      }
      
      if (exampleCount === 0) {
        doc.text('• No detailed examples available', { indent: 10 });
      }
      
      doc.moveDown(0.8);
      
      // Duplicates section
      if (aiValidation.duplicates && aiValidation.duplicates.exact_url_duplicates > 0) {
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .text('Duplicate Activity:');
        
        doc.fontSize(8)
           .font('Helvetica')
           .text(`${aiValidation.duplicates.exact_url_duplicates} exact duplicate URLs detected`, { indent: 10 });
        
        if (aiValidation.duplicates.top_endpoints && aiValidation.duplicates.top_endpoints.length > 0) {
          const topEndpoints = aiValidation.duplicates.top_endpoints.slice(0, 3);
          doc.text('Top endpoints:', { indent: 10 });
          topEndpoints.forEach(ep => {
            doc.fillColor('#6B7280')
               .text(`  • ${ep.endpoint} (${ep.count} calls)`, { indent: 15 });
          });
          doc.fillColor('#000000');
        }
        
        doc.moveDown(0.8);
      }
      
      // Corroboration section (CMS monitor if available)
      if (caseBrief.cms_monitor) {
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .text('Corroboration (CMS Monitor):');
        
        doc.fontSize(8)
           .font('Helvetica')
           .text(`Total Scripts: ${caseBrief.cms_monitor.total_scripts || 0}`, { indent: 10 });
        
        if (caseBrief.cms_monitor.unauthorized_count > 0) {
          doc.fillColor('#DC2626')
             .text(`Unauthorized: ${caseBrief.cms_monitor.unauthorized_count}`, { indent: 10 });
          doc.fillColor('#000000');
        }
        
        if (caseBrief.cms_monitor.injected_scripts_count > 0) {
          doc.fillColor('#DC2626')
             .text(`Injected: ${caseBrief.cms_monitor.injected_scripts_count}`, { indent: 10 });
          doc.fillColor('#000000');
        }
        
        doc.moveDown(0.8);
      }
      
      // Limitations
      if (aiValidation.limitations && aiValidation.limitations.length > 0) {
        doc.fontSize(9)
           .font('Helvetica-Bold')
           .text('Limitations:');
        
        doc.fontSize(7)
           .font('Helvetica')
           .fillColor('#6B7280');
        
        aiValidation.limitations.slice(0, 3).forEach(limitation => {
          doc.text(`• ${limitation}`, { indent: 10 });
        });
        
        doc.fillColor('#000000');
        doc.moveDown(0.8);
      }
      
      // Move to bottom for footer
      const bottomY = 720; // Leave space for footer
      if (doc.y < bottomY) {
        doc.y = bottomY;
      }
      
      // Footer with metadata
      doc.moveTo(50, doc.y)
         .lineTo(562, doc.y)
         .stroke();
      
      doc.moveDown(0.3);
      
      doc.fontSize(7)
         .font('Helvetica')
         .fillColor('#6B7280');
      
      doc.text(`Provider: ${aiValidation.model_used.provider} | Model: ${aiValidation.model_used.model}`, { continued: false });
      doc.text(`Prompt Version: ${aiValidation.prompt_version} | Generated: ${new Date(aiValidation.model_used.run_at).toLocaleString()}`);
      doc.text(`Input Fingerprint: ${aiValidation.input_fingerprint.substring(0, 16)}...`);
      doc.text(`Output Fingerprint: ${aiValidation.output_fingerprint.substring(0, 16)}...`);
      
      // Finalize PDF
      doc.end();
      
      stream.on('finish', () => {
        resolve(outputPath);
      });
      
      stream.on('error', reject);
      
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateEvidencePDF
};


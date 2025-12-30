import PDFDocument from 'pdfkit';
import fs from 'fs';
import { ValidatorResult } from '../validator/schema';

export async function buildValidatorReport(result: ValidatorResult, destPath: string) {
  return new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(destPath);
    doc.pipe(stream);

    doc.fontSize(18).text('AI Validation Report', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`Verdict: ${result.verdict}`);
    doc.text(`Score: ${result.score}`);
    doc.text(`Confidence: ${result.confidence}%`);
    doc.text(`Target: ${result.target.domain} (${result.target.url})`);
    doc.moveDown();

    doc.fontSize(14).text('Executive Summary');
    doc.fontSize(11).text(result.auditorSafeLanguage.executiveSummary);
    doc.moveDown();

    doc.fontSize(14).text('Top Signals');
    (result.topSignals || []).forEach((s, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${s.signalId} [${s.severity}]`);
      doc.fontSize(11).text(s.summary, { indent: 12 });
      doc.fontSize(10).text(`Evidence: ${s.evidence.map((e) => e.pointer).join(', ')}`, { indent: 12 });
      doc.moveDown(0.25);
    });

    doc.moveDown();
    doc.fontSize(14).text('Findings');
    (result.findings || []).forEach((f, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${f.title} (Impact: ${f.impact})`);
      doc.fontSize(11).text(f.description, { indent: 12 });
      doc.fontSize(10).text(`Evidence: ${f.evidence.map((e) => e.pointer).join(', ')}`, { indent: 12 });
      doc.fontSize(10).text(`False-positive checks: ${f.falsePositiveChecks.join('; ')}`, { indent: 12 });
      doc.fontSize(10).text(`Recommended actions: ${f.recommendedActions.join('; ')}`, { indent: 12 });
      doc.moveDown(0.25);
    });

    doc.moveDown();
    doc.fontSize(12).text('Methodology:');
    doc.fontSize(10).text(result.auditorSafeLanguage.methodologyNote);
    doc.moveDown();
    doc.fontSize(12).text('Limitations:');
    doc.fontSize(10).text(result.auditorSafeLanguage.limitationNote);

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}


# AI Validation Module - Documentation Index

Welcome to the AI Validation module documentation. This index will help you find what you need quickly.

## 📖 Documentation Files

### 🚀 [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
**Start here if you want to get running fast!**
- 30-second quick start
- API cheat sheet
- Common commands
- Troubleshooting one-liners
- Best practices

**Best for:** Developers who want to start using the module immediately

---

### 📚 [README.md](README.md)
**Complete technical documentation**
- Features overview
- Architecture details
- API endpoint documentation
- Evidence pack format
- Validation templates
- Output schema reference
- Programmatic usage examples
- Security considerations

**Best for:** Understanding how everything works and detailed API usage

---

### 🔧 [SETUP.md](SETUP.md)
**Step-by-step installation and configuration**
- Prerequisites
- Dependency installation
- API key configuration
- Server startup
- Test evidence pack creation
- Troubleshooting common issues
- Advanced configuration

**Best for:** First-time setup or troubleshooting installation issues

---

### 📋 [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
**Technical implementation details**
- Architecture decisions
- Design patterns
- File organization
- Requirements checklist
- Performance metrics
- Testing strategy

**Best for:** Understanding the codebase architecture and implementation details

---

## 🎯 Quick Navigation

### I want to...

#### Get started immediately
→ [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - 30-second quick start

#### Set up for the first time
→ [SETUP.md](SETUP.md) - Step-by-step setup guide

#### Understand the API
→ [README.md](README.md#api-endpoints) - API documentation

#### Add a new validation template
→ [README.md](README.md#adding-new-templates) - Template guide

#### Use programmatically
→ [README.md](README.md#programmatic-usage) - Code examples

#### Troubleshoot an issue
→ [SETUP.md](SETUP.md#troubleshooting) - Common issues  
→ [QUICK_REFERENCE.md](QUICK_REFERENCE.md#-common-issues) - Quick fixes

#### Understand the architecture
→ [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) - Technical details

#### Run tests
→ [README.md](README.md#testing) - Testing guide  
→ [QUICK_REFERENCE.md](QUICK_REFERENCE.md#-testing) - Test commands

---

## 📁 Module Structure

```
ai-validation/
├── 📄 INDEX.md                    ← You are here
├── 📄 QUICK_REFERENCE.md          ← Quick start & cheat sheet
├── 📄 README.md                   ← Full documentation
├── 📄 SETUP.md                    ← Installation guide
├── 📄 IMPLEMENTATION_SUMMARY.md   ← Technical details
│
├── schemas/                       ← JSON schemas
│   ├── ai_validation.schema.json
│   └── case_brief.schema.json
│
├── parser/                        ← Evidence pack parser
│   └── evidence-pack-parser.cjs
│
├── providers/                     ← AI provider implementations
│   ├── base-provider.cjs
│   ├── openai-provider.cjs
│   ├── gemini-provider.cjs
│   ├── perplexity-provider.cjs
│   └── provider-factory.cjs
│
├── templates/                     ← Validation templates
│   └── registry.cjs
│
├── pdf/                          ← PDF generator
│   └── generator.cjs
│
└── orchestrator.cjs              ← Main workflow coordinator
```

---

## 🎓 Learning Path

### Beginner
1. Read [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Get familiar with basics
2. Follow [SETUP.md](SETUP.md) - Set up your environment
3. Try the UI at `http://localhost:3000/ai-validation`

### Intermediate
1. Read [README.md](README.md) - Understand full capabilities
2. Try programmatic usage examples
3. Review test files in `../tests/ai-validation-*.test.js`

### Advanced
1. Read [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) - Understand architecture
2. Review source code in subdirectories
3. Add custom templates or providers

---

## 🔗 External Resources

### API Keys
- [OpenAI API Keys](https://platform.openai.com/api-keys)
- [Google Gemini API Keys](https://aistudio.google.com/app/apikey)
- [Perplexity API Keys](https://www.perplexity.ai/settings/api)

### Documentation
- [JSON Schema Documentation](https://json-schema.org/)
- [PDFKit Documentation](https://pdfkit.org/)
- [OpenAI API Docs](https://platform.openai.com/docs)
- [Google Gemini API Docs](https://ai.google.dev/docs)
- [Perplexity API Docs](https://docs.perplexity.ai/)

---

## 📞 Support

### Having issues?

1. **Check Quick Reference** → [Common Issues](QUICK_REFERENCE.md#-common-issues)
2. **Check Setup Guide** → [Troubleshooting](SETUP.md#troubleshooting)
3. **Check Full Docs** → [README Troubleshooting](README.md#troubleshooting)
4. **Review Test Files** → `../tests/ai-validation-*.test.js`
5. **Check Server Logs** → Run `npm run start:server` and watch output

---

## 🎯 Common Tasks

| Task | Documentation |
|------|---------------|
| First-time setup | [SETUP.md](SETUP.md) |
| Quick start | [QUICK_REFERENCE.md](QUICK_REFERENCE.md) |
| API reference | [README.md](README.md#api-endpoints) |
| Add template | [README.md](README.md#adding-new-templates) |
| Programmatic use | [README.md](README.md#programmatic-usage) |
| Run tests | [README.md](README.md#testing) |
| Troubleshoot | [SETUP.md](SETUP.md#troubleshooting) |
| Understand architecture | [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) |

---

## 📊 File Sizes

| File | Lines | Purpose |
|------|-------|---------|
| QUICK_REFERENCE.md | ~350 | Quick start & cheat sheet |
| README.md | ~800 | Complete documentation |
| SETUP.md | ~450 | Installation & setup |
| IMPLEMENTATION_SUMMARY.md | ~600 | Technical details |
| INDEX.md | ~200 | This navigation file |

---

## ✅ Quick Checklist

Before using the module, ensure:

- [ ] Node.js 18+ installed
- [ ] Dependencies installed (`npm install`)
- [ ] At least one API key set (OPENAI_API_KEY, GEMINI_API_KEY, or PERPLEXITY_API_KEY)
- [ ] Server running (`npm run start:server`)
- [ ] Can access UI at `http://localhost:3000/ai-validation`

---

## 🚀 Next Steps

1. **New user?** → Start with [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
2. **Setting up?** → Follow [SETUP.md](SETUP.md)
3. **Need details?** → Read [README.md](README.md)
4. **Want to contribute?** → Review [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)

---

**Happy validating! 🎉**


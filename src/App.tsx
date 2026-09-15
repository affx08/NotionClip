import { useState, useEffect } from 'react';
import browser from "webextension-polyfill";
import { LogIn, Save, Settings, Check, Loader2, Database, BookOpen, Copy, Link, ChevronDown, Image as ImageIcon, ChevronsUpDown, Plus, Calendar } from "lucide-react";
import { parseMarkdownToNotionBlocks } from './utils/notion-parser';

interface ArticleData {
  title: string;
  url: string;
  markdown: string;
  meta: {
    property: Record<string, string>;
    name: Record<string, string>;
  };
  schema: Record<string, any>;
  image: string;
  description: string;
  author: string;
  domain: string;
  favicon: string;
  published: string;
  site: string;
  time: string;
  date: string;
  allImages: string[];
}

interface NotionDestination {
  id: string;
  name: string;
  type: "database" | "page";
}

export interface UserTemplate {
  id: string;
  name: string;
  destinationId: string;
  map: Record<string, string>;
  propertyOrder?: string[];
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [workspaceInfo, setWorkspaceInfo] = useState<{ name: string; icon: string } | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isClipping, setIsClipping] = useState(false);
  const [clipSuccess, setClipSuccess] = useState(false);
  
  const [articleData, setArticleData] = useState<ArticleData | null>(null);
  const [titleStr, setTitleStr] = useState("");

  const [destinations, setDestinations] = useState<NotionDestination[]>([]);
  const [selectedDestination, setSelectedDestination] = useState<string>("");
  const [urlStr, setUrlStr] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentView, setCurrentView] = useState<"home" | "clipper" | "template_builder" | "variables">("home");
  const [varSearchQuery, setVarSearchQuery] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);

  // Template Engine State
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<UserTemplate | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [dbProperties, setDbProperties] = useState<Record<string, any> | null>(null);
  
  // Live Clipper State
  const [activeClipData, setActiveClipData] = useState<Record<string, any>>({});
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const filteredDestinations = destinations.filter(d => 
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedDestObj = destinations.find(d => d.id === selectedDestination);

  useEffect(() => {
    checkAuth();
    fetchArticleData();
  }, []);

  // Fetch schema when destination changes
  useEffect(() => {
    if (selectedDestObj && selectedDestObj.type === "database" && accessToken) {
      fetchDatabaseSchema(selectedDestObj.id, accessToken);
    } else {
      setDbProperties(null);
      setActiveClipData({});
    }
  }, [selectedDestination, destinations, accessToken]);

  // When template map or article data is loaded/updated, resolve activeClipData
  useEffect(() => {
    if (dbProperties && articleData) {
      const resolvedData: Record<string, any> = {};
      const template = templates.find(t => t.id === selectedTemplateId);
      const map = template ? template.map : {};
      
      Object.keys(dbProperties).forEach(prop => {
        resolvedData[prop] = resolveTemplate(map[prop] || "", articleData);
      });
      setActiveClipData(resolvedData);
    }
  }, [dbProperties, selectedTemplateId, templates, articleData]);

  const checkAuth = async () => {
    try {
      const storage = await browser.storage.local.get(["notion_access_token", "notion_workspace_name", "notion_workspace_icon", "notion_templates"]) as { notion_access_token?: string, notion_workspace_name?: string, notion_workspace_icon?: string, notion_templates?: UserTemplate[] };
      if (storage.notion_access_token) {
        setIsAuthenticated(true);
        setAccessToken(storage.notion_access_token);
        
        let icon = storage.notion_workspace_icon || "📝";
        if (icon.startsWith("notion://") || icon.length > 10 && !icon.startsWith("http")) {
          icon = "📝";
        }

        setWorkspaceInfo({
          name: storage.notion_workspace_name || "Notion Workspace",
          icon: icon
        });
        
        if (storage.notion_templates) {
          setTemplates(storage.notion_templates);
        }
        fetchDestinations(storage.notion_access_token);
        
        // Restore picker state if any
        try {
          const pickerStorage = await browser.storage.local.get([
            "notion_picker_result", 
            "notion_picker_prop", 
            "notion_picker_template", 
            "notion_picker_destination", 
            "notion_picker_activeData"
          ]);
          
          if (pickerStorage.notion_picker_result && pickerStorage.notion_picker_prop) {
            if (pickerStorage.notion_picker_template) setSelectedTemplateId(pickerStorage.notion_picker_template as string);
            if (pickerStorage.notion_picker_destination) setSelectedDestination(pickerStorage.notion_picker_destination as string);
            
            const restoredData = (pickerStorage.notion_picker_activeData as Record<string, any>) || {};
            const propName = pickerStorage.notion_picker_prop as string;
            restoredData[propName] = pickerStorage.notion_picker_result;
            
            setActiveClipData(restoredData);
            setCurrentView("clipper");
            showToast("Image loaded from picker!");
            
            await browser.storage.local.remove([
              "notion_picker_result", 
              "notion_picker_prop", 
              "notion_picker_template", 
              "notion_picker_destination", 
              "notion_picker_activeData",
              "notion_picker_active"
            ]);
          }
        } catch (e) {
          console.warn("Picker restore failed", e);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDatabaseSchema = async (dbId: string, token: string) => {
    try {
      const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Notion-Version": "2022-06-28"
        }
      });
      const data = await res.json();
      if (data.properties) {
        setDbProperties(data.properties);
      }
    } catch (e) {
      console.error("Failed to fetch database schema:", e);
    }
  };

  const fetchDestinations = async (token: string) => {
    try {
      const res = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filter: { value: "database", property: "object" },
          sort: { direction: "descending", timestamp: "last_edited_time" }
        })
      });
      const data = await res.json();
      
      const resPages = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filter: { value: "page", property: "object" },
          sort: { direction: "descending", timestamp: "last_edited_time" }
        })
      });
      const pageData = await resPages.json();

      const combined = [
        ...data.results.map((d: any) => ({ id: d.id, name: d.title?.[0]?.plain_text || "Untitled Database", type: "database" })),
        ...pageData.results.map((p: any) => {
          let name = "Untitled Page";
          if (p.properties?.title?.title?.[0]?.plain_text) name = p.properties.title.title[0].plain_text;
          else if (p.properties?.Name?.title?.[0]?.plain_text) name = p.properties.Name.title[0].plain_text;
          return { id: p.id, name, type: "page" };
        })
      ];
      setDestinations(combined);
      if (combined.length > 0) setSelectedDestination(combined[0].id);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchArticleData = async () => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      
      if (currentTab) {
        setTitleStr(currentTab.title || "Clipped Web Page");
        setUrlStr(currentTab.url || "");

        if (currentTab.url && !currentTab.url.startsWith("http")) {
          setArticleData({
            title: currentTab.title || "",
            url: currentTab.url,
            markdown: "Cannot extract content from this type of page. (Browser system pages or blank tabs are protected). You can still save the link!",
            meta: { property: {}, name: {} },
            schema: {},
            image: "",
            description: "", author: "", domain: "", favicon: "", published: "", site: "", time: "", date: "", allImages: []
          });
          return;
        }

        try {
          const fastResponse = await browser.tabs.sendMessage(currentTab.id!, { action: "parse_article_fast" }) as any;
          if (fastResponse && fastResponse.title) {
            setArticleData(fastResponse as ArticleData);
            setTitleStr(fastResponse.title);
            setUrlStr(fastResponse.url);
            
            // Fire off the slow markdown extraction in the background
            browser.tabs.sendMessage(currentTab.id!, { action: "parse_article_markdown" })
              .then((slowResponse: any) => {
                if (slowResponse && slowResponse.markdown) {
                  setArticleData((prev) => prev ? { ...prev, markdown: slowResponse.markdown } : prev);
                }
              })
              .catch(err => console.warn("Markdown extraction failed in background", err));
              
          } else {
            throw new Error("No response from content script");
          }
        } catch (err) {
          console.warn("Content script failed or not loaded.", err);
          setNeedsRefresh(true);
        }
      }
    } catch (error) {
      console.warn("Could not query tabs", error);
    }
  };

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      const response = await browser.runtime.sendMessage({ action: "login" }) as any;
      if (response && response.success) {
        checkAuth();
      } else {
        alert("Login failed: " + response?.error);
        setIsLoading(false);
      }
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (confirm("Are you sure you want to log out from Notion?")) {
      await browser.storage.local.clear();
      setIsAuthenticated(false);
      setAccessToken(null);
    }
  };

  const handleSaveToNotion = async () => {
    if (!articleData || !selectedDestination || !accessToken) return;
    setIsClipping(true);

    try {
      const dest = destinations.find(d => d.id === selectedDestination);
      if (!dest) throw new Error("Invalid destination");

      const blocks = parseMarkdownToNotionBlocks(articleData.markdown);
      
      let payload: any = {
        parent: dest.type === "database" ? { database_id: dest.id } : { page_id: dest.id },
        properties: {},
        children: blocks.slice(0, 100)
      };

      if (dest.type === "database" && dbProperties) {
        // Dynamic property mapping based on active clip data
        Object.entries(dbProperties).map(([propName, propDef]) => {
          const resolvedValue = (activeClipData[propName] || "").trim();
          
          if (!resolvedValue && propDef.type !== "checkbox") return; // Skip empty properties except checkbox which evaluates false
          
          // Format based on property type
          if (propDef.type === "title") {
            payload.properties[propName] = { title: [{ text: { content: resolvedValue.slice(0, 2000) } }] };
          } else if (propDef.type === "rich_text") {
            payload.properties[propName] = { rich_text: [{ text: { content: resolvedValue.slice(0, 2000) } }] };
          } else if (propDef.type === "url") {
            payload.properties[propName] = { url: resolvedValue };
          } else if (propDef.type === "email") {
            payload.properties[propName] = { email: resolvedValue };
          } else if (propDef.type === "phone_number") {
            payload.properties[propName] = { phone_number: resolvedValue };
          } else if (propDef.type === "number") {
            const num = parseFloat(resolvedValue);
            if (!isNaN(num)) payload.properties[propName] = { number: num };
          } else if (propDef.type === "checkbox") {
            payload.properties[propName] = { checkbox: ["true", "yes", "1", "y"].includes(resolvedValue.toLowerCase()) };
          } else if (propDef.type === "date") {
            try {
              const d = new Date(resolvedValue);
              if (!isNaN(d.getTime())) {
                payload.properties[propName] = { date: { start: d.toISOString() } };
              }
            } catch (e) {}
          } else if (propDef.type === "select" || propDef.type === "status") {
            const key = propDef.type === "status" ? "status" : "select";
            payload.properties[propName] = { [key]: { name: resolvedValue.slice(0, 100) } };
          } else if (propDef.type === "multi_select") {
            const tags = resolvedValue.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
            if (tags.length > 0) {
              payload.properties[propName] = { multi_select: tags.map((t: string) => ({ name: t.slice(0, 100) })) };
            }
          } else if (propDef.type === "files") {
            if (resolvedValue.startsWith("http")) {
              payload.properties[propName] = { files: [{ name: "Clipped File", type: "external", external: { url: resolvedValue } }] };
            }
          }
        });
        
        // Ensure at least one title property exists to prevent Notion API errors
        const hasTitle = Object.keys(payload.properties).some(k => dbProperties[k].type === "title");
        if (!hasTitle) {
          const titleProp = Object.keys(dbProperties).find(k => dbProperties[k].type === "title");
          if (titleProp) {
            payload.properties[titleProp] = { title: [{ text: { content: titleStr.slice(0, 2000) || "Untitled" } }] };
          }
        }
      } else {
        // Fallback for regular Pages
        payload.properties = {
          "title": { title: [{ text: { content: titleStr.slice(0, 2000) } }] }
        };
      }

      const res = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save page");
      }
      
      setClipSuccess(true);
      setTimeout(() => window.close(), 2000);
    } catch (error: any) {
      console.error(error);
      alert("Failed to clip to Notion: " + error.message);
    } finally {
      setIsClipping(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full h-[500px] flex items-center justify-center bg-[#1e1e1e]">
        <Loader2 className="animate-spin text-white" size={32} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="w-full h-[500px] flex flex-col bg-[#1e1e1e] text-gray-200">
        <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-6 text-center">
          <div className="w-20 h-20 bg-[#252526] rounded-2xl flex items-center justify-center shadow-lg border border-[#333]">
            <span className="text-4xl">✂️</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Obbi Web Clipper</h1>
            <p className="text-sm text-gray-400">Your Obsidian-style power tool for Notion.</p>
          </div>
          
          <button 
            onClick={handleLogin}
            className="w-full py-3 px-4 bg-white text-black hover:bg-gray-200 transition-colors rounded-lg font-medium flex items-center justify-center gap-2 shadow-lg shadow-white/10"
          >
            <LogIn size={18} />
            Connect to Notion
          </button>
          
          <div className="pt-4 text-[10px] text-gray-600 w-full text-center break-all">
            Redirect URI for Notion Dashboard:<br/>
            <span className="font-mono text-gray-500 user-select-all">{browser.identity.getRedirectURL()}</span>
          </div>
        </div>
    </div>
    );
  }

  const handleTemplateMapChange = (prop: string, value: string) => {
    if (editingTemplate) {
      setEditingTemplate({
        ...editingTemplate,
        map: { ...editingTemplate.map, [prop]: value }
      });
    }
  };

  const handleSaveTemplate = async () => {
    if (!editingTemplate || !editingTemplate.name || !editingTemplate.destinationId) {
      showToast("Name and Destination are required");
      return;
    }
    
    const templateToSave = {
      ...editingTemplate,
      id: editingTemplate.id || `tpl_${Date.now()}`
    };

    let newTemplates;
    if (editingTemplate.id) {
      newTemplates = templates.map(t => t.id === editingTemplate.id ? templateToSave : t);
    } else {
      newTemplates = [...templates, templateToSave];
    }
    
    setTemplates(newTemplates);
    await browser.storage.local.set({ notion_templates: newTemplates });
    showToast("Template saved!");
    setCurrentView("home");
  };

  const handleDeleteTemplate = async (id: string) => {
    const newTemplates = templates.filter(t => t.id !== id);
    setTemplates(newTemplates);
    await browser.storage.local.set({ notion_templates: newTemplates });
    showToast("Template deleted");
  };

  const handlePickImage = async (propName: string) => {
    await browser.storage.local.set({
      notion_picker_active: true,
      notion_picker_prop: propName,
      notion_picker_template: selectedTemplateId,
      notion_picker_destination: selectedDestination,
      notion_picker_activeData: activeClipData
    });
    
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0] && tabs[0].id) {
      await browser.tabs.sendMessage(tabs[0].id, { action: "activate_image_picker" });
    }
    
    window.close();
  };

  const resolveTemplate = (template: string, data: ArticleData | null): string => {
    if (!data || !template) return template || "";
    let resolved = template;
    
    resolved = resolved.replace(/{{url}}/g, data.url || "");
    resolved = resolved.replace(/{{title}}/g, data.title || "");
    resolved = resolved.replace(/{{image}}/g, data.image || "");
    resolved = resolved.replace(/{{content}}/g, data.markdown || "");
    
    resolved = resolved.replace(/{{meta:property:([^}]+)}}/g, (_, prop) => {
      return data.meta?.property?.[prop] || "";
    });
    
    resolved = resolved.replace(/{{meta:name:([^}]+)}}/g, (_, prop) => {
      return data.meta?.name?.[prop] || "";
    });

    resolved = resolved.replace(/{{schema:@([^:]+):([^}]+)}}/g, (_, type, prop) => {
      return data.schema?.[type]?.[prop] || "";
    });

    return resolved;
  };

  const getAvailableVariables = () => {
    if (!articleData) return [];
    
    const vars: { key: string; value: string; }[] = [
      { key: "{{title}}", value: articleData.title || "" },
      { key: "{{url}}", value: articleData.url || "" },
      { key: "{{image}}", value: articleData.image || "" },
      { key: "{{description}}", value: articleData.description || "" },
      { key: "{{author}}", value: articleData.author || "" },
      { key: "{{domain}}", value: articleData.domain || "" },
      { key: "{{favicon}}", value: articleData.favicon || "" },
      { key: "{{published}}", value: articleData.published || "" },
      { key: "{{site}}", value: articleData.site || "" },
      { key: "{{time}}", value: articleData.time || "" },
      { key: "{{date}}", value: articleData.date || "" },
      { key: "{{content}}", value: "Raw markdown text..." }
    ];

    if (articleData.meta) {
      Object.entries(articleData.meta.property || {}).forEach(([k, v]) => {
        vars.push({ key: `{{meta:property:${k}}}`, value: v });
      });
      Object.entries(articleData.meta.name || {}).forEach(([k, v]) => {
        vars.push({ key: `{{meta:name:${k}}}`, value: v });
      });
    }

    if (articleData.schema) {
      Object.entries(articleData.schema).forEach(([type, obj]) => {
        if (typeof obj === 'object' && obj !== null) {
          Object.entries(obj).forEach(([prop, val]) => {
             if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
               vars.push({ key: `{{schema:@${type}:${prop}}}`, value: String(val) });
             }
          });
        }
      });
    }
    
    // Filter out empties from the top list to clean up the UI
    return vars.filter(v => v.value.trim() !== "").sort((a, b) => a.key.localeCompare(b.key));
  };

  return (
    <div className="w-full min-h-[500px] max-h-[600px] flex flex-col bg-[#161616] text-gray-200 font-sans relative pb-24 overflow-hidden">
      {/* Modern textured background effects */}
      <div className="grainy-bg"></div>
      <div className="grainy-blob"></div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 bg-[#252525] border border-[#444] text-white text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
          <Check size={14} />
          {toastMessage}
        </div>
      )}

      <header className="px-4 py-3 border-b border-[#252525] flex items-center justify-between bg-[#161616] z-40">
        <div className="flex items-center gap-3">
          {currentView !== "home" ? (
            <>
              <button 
                onClick={() => setCurrentView("home")}
                className="text-white hover:text-gray-300 transition-colors flex items-center justify-center rounded-full p-1 -ml-1"
              >
                <span className="text-xl">←</span>
              </button>
              {currentView === "clipper" ? (
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-white tracking-tight">
                    {templates.find(t => t.id === selectedTemplateId)?.name || "Reading list"}
                  </span>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#252525] rounded-full text-[11px] font-medium text-gray-300 border border-[#333]">
                    <span>✨</span>
                    {templates.find(t => t.id === selectedTemplateId)?.name || "Movie Save"}
                  </div>
                </div>
              ) : (
                <span className="text-sm font-bold text-white capitalize">{currentView.replace("_", " ")}</span>
              )}
            </>
          ) : (
            <>
              <span className="text-xl">{workspaceInfo?.icon}</span>
              <span className="text-sm font-medium text-gray-300">{workspaceInfo?.name}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {currentView === "home" && (
            <button 
              onClick={() => setCurrentView("variables")}
              className={`text-gray-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-[#252525]`}
              title="View Page Variables"
            >
              <BookOpen size={18} />
            </button>
          )}
          {currentView === "clipper" ? (
            <button 
              onClick={() => setCurrentView("home")}
              className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-[#252525]"
            >
              <span className="text-lg leading-none">✕</span>
            </button>
          ) : (
            <button 
              onClick={() => handleLogout()}
              className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-[#252525]"
              title="Logout of Notion"
            >
              <LogIn size={18} />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 p-5 space-y-5 overflow-y-auto">
        {needsRefresh ? (
          <div className="flex flex-col items-center justify-center h-[400px] text-center space-y-4 px-4">
            <div className="text-5xl text-white opacity-80 mb-2">🔄</div>
            <h2 className="text-xl font-bold text-white tracking-wide">Please Refresh The Page</h2>
            <p className="text-sm text-gray-400 max-w-[280px]">
              The extension was just updated. You need to refresh this webpage so the new web clipper engine can load!
            </p>
            <button 
              onClick={() => window.close()}
              className="mt-4 px-6 py-2 bg-white text-black hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
            >
              Close Clipper
            </button>
          </div>
        ) : currentView === "home" && (
          <div className="space-y-4">
            <button 
              onClick={() => {
                setEditingTemplate({ id: "", name: "", destinationId: selectedDestination, map: {}, propertyOrder: [] });
                setCurrentView("template_builder");
              }}
              className="w-full py-2.5 bg-[#252526] hover:bg-[#333] border border-dashed border-[#555] rounded-lg text-sm text-gray-300 flex items-center justify-center gap-2 transition-colors"
            >
              <span className="text-lg">+</span> Create New Template
            </button>
            
            <div className="space-y-2">
              <label className="text-xs font-semibold text-white uppercase tracking-wider">Your Templates</label>
              {templates.length === 0 ? (
                <div className="text-xs text-gray-500 py-4 text-center">No templates created yet.</div>
              ) : (
                templates.map(t => (
                  <div key={t.id} className="flex gap-2">
                    <button 
                      onClick={() => {
                        setSelectedTemplateId(t.id);
                        setSelectedDestination(t.destinationId);
                        setCurrentView("clipper");
                      }}
                      className="flex-1 bg-[#1a1a1a] hover:bg-[#333] border border-[#333] hover:border-[#555] rounded-lg p-3 text-left transition-all"
                    >
                      <div className="text-sm font-medium text-white">{t.name}</div>
                      <div className="text-xs text-gray-500 mt-1 truncate">Database: {destinations.find(d => d.id === t.destinationId)?.name || "Unknown"}</div>
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedDestination(t.destinationId);
                        setEditingTemplate(t);
                        setCurrentView("template_builder");
                      }}
                      className="p-3 bg-[#1a1a1a] hover:bg-[#333] border border-[#333] rounded-lg text-gray-400 hover:text-white transition-colors"
                      title="Edit Template"
                    >
                      <Settings size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {articleData?.markdown === "Extracting markdown..." && (
                <div className="text-xs text-white flex items-center justify-center gap-2 py-2 animate-pulse">
                  <span>Extracting deep markdown...</span>
                </div>
              )}

            <div className="pt-4 border-t border-[#333] pb-2">
              <button 
                onClick={() => {
                  setSelectedTemplateId(null);
                  setCurrentView("clipper");
                }}
                className="w-full py-2.5 bg-[#2a2a2a] hover:bg-[#333] border border-[#555] rounded-lg text-sm text-gray-300 flex items-center justify-center gap-2 transition-colors"
              >
                Quick Save (No Template)
              </button>
            </div>
          </div>
        )}

        {(currentView === "template_builder" || (currentView === "clipper" && !selectedTemplateId)) && (
          <div className="space-y-1.5 relative z-20">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Destination</label>
            <div className="relative">
              <button 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full bg-[#252526] border border-[#333] rounded-lg px-3 py-2.5 text-sm text-left text-white focus:outline-none focus:border-[#555] focus:ring-1 focus:ring-[#555] flex items-center justify-between"
              >
                <div className="flex items-center gap-2 truncate">
                  <Database size={16} className="text-white shrink-0" />
                  <span className="truncate">{selectedDestObj ? selectedDestObj.name : "Select a destination..."}</span>
                </div>
                <span className="text-gray-500 text-xs">▼</span>
              </button>
              
              {isDropdownOpen && (
                <div className="absolute z-10 w-full mt-1 bg-[#252526] border border-[#333] rounded-lg shadow-xl overflow-hidden flex flex-col">
                  <div className="p-2 border-b border-[#333]">
                    <input 
                      type="text" 
                      placeholder="Search databases & pages..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[#1a1a1a] border border-[#333] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#555]"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredDestinations.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-gray-500 text-center">No results found</div>
                    ) : (
                      filteredDestinations.map(dest => (
                        <button
                          key={dest.id}
                          onClick={() => {
                            setSelectedDestination(dest.id);
                            if (editingTemplate) {
                              setEditingTemplate({ ...editingTemplate, destinationId: dest.id });
                            }
                            setIsDropdownOpen(false);
                            setSearchQuery("");
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-[#333] transition-colors ${selectedDestination === dest.id ? 'bg-[#333] text-gray-300' : 'text-gray-300'}`}
                        >
                          {dest.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {currentView === "template_builder" && editingTemplate && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Template Name</label>
              <input 
                type="text" 
                value={editingTemplate.name}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#555] focus:ring-1 focus:ring-[#555]"
                placeholder="e.g. Movie Save"
              />
            </div>
            
            {selectedDestObj?.type === "database" ? (
              <div className="space-y-4 pt-4 border-t border-[#333]">
                <div className="flex items-center justify-between border-b border-[#333] pb-2">
                  <label className="text-xs font-semibold text-white uppercase tracking-wider">Property Mapping</label>
                </div>
                {!dbProperties ? (
                  <div className="text-center py-4 text-sm text-gray-500">Loading properties...</div>
                ) : (
                  (() => {
                    const allProps = Object.keys(dbProperties);
                    const orderedProps = (editingTemplate.propertyOrder || []).filter(p => allProps.includes(p));
                    const missingProps = allProps.filter(p => !orderedProps.includes(p));
                    const finalOrder = [...orderedProps, ...missingProps];

                    const moveProp = (index: number, direction: -1 | 1) => {
                      const newOrder = [...finalOrder];
                      if (index + direction >= 0 && index + direction < newOrder.length) {
                        const temp = newOrder[index];
                        newOrder[index] = newOrder[index + direction];
                        newOrder[index + direction] = temp;
                        setEditingTemplate({ ...editingTemplate, propertyOrder: newOrder });
                      }
                    };

                    return finalOrder.map((propName, index) => {
                      const propDef = dbProperties[propName];
                      return (
                        <div key={propName} className="space-y-1">
                          <div className="flex justify-between items-center">
                            <label className="text-xs font-medium text-gray-300">{propName}</label>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-500 uppercase px-1.5 py-0.5 bg-[#333] rounded">{propDef.type}</span>
                              <div className="flex items-center bg-[#1a1a1a] rounded border border-[#333]">
                                <button 
                                  onClick={() => moveProp(index, -1)}
                                  disabled={index === 0}
                                  className="px-1.5 text-gray-400 hover:bg-[#333] disabled:opacity-30 disabled:hover:bg-transparent"
                                >↑</button>
                                <button 
                                  onClick={() => moveProp(index, 1)}
                                  disabled={index === finalOrder.length - 1}
                                  className="px-1.5 text-gray-400 hover:bg-[#333] disabled:opacity-30 disabled:hover:bg-transparent border-l border-[#333]"
                                >↓</button>
                              </div>
                            </div>
                          </div>
                          <input 
                            type="text" 
                            value={editingTemplate.map[propName] ?? ""}
                            onChange={(e) => handleTemplateMapChange(propName, e.target.value)}
                            className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#555] focus:ring-1 focus:ring-[#555] transition-all font-mono placeholder-gray-600"
                            placeholder="e.g. {{title}}"
                          />
                          {editingTemplate.map[propName] && (
                            <div className="text-[10px] text-gray-400 mt-0.5 pl-1 truncate">
                              ↳ {resolveTemplate(editingTemplate.map[propName], articleData) || <span className="italic text-gray-600">empty</span>}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()
                )}
                
                <div className="flex gap-2 pt-4">
                  {editingTemplate.id && (
                    <button 
                      onClick={() => handleDeleteTemplate(editingTemplate.id)}
                      className="px-4 py-2 bg-[#2a2a2a] hover:bg-[#444] text-white rounded-lg text-sm transition-colors border border-[#555]"
                    >
                      Delete
                    </button>
                  )}
                  <button 
                    onClick={handleSaveTemplate}
                    className="flex-1 px-4 py-2 bg-white text-black hover:bg-gray-200 rounded-lg text-sm transition-colors shadow-lg shadow-white/10"
                  >
                    Save Template
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-sm text-gray-500">
                Select a Database to configure property mappings.
              </div>
            )}
          </div>
        )}

        {currentView === "variables" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#333] pb-2">
              <label className="text-xs font-semibold text-white uppercase tracking-wider">Page Variables</label>
              <span className="text-[10px] text-gray-500">Click variable to copy</span>
            </div>
            
            <input 
              type="text" 
              placeholder="Search variables..." 
              value={varSearchQuery}
              onChange={(e) => setVarSearchQuery(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#555]"
            />
            
            <div className="space-y-2">
              {getAvailableVariables()
                .filter(v => v.key.toLowerCase().includes(varSearchQuery.toLowerCase()) || v.value.toLowerCase().includes(varSearchQuery.toLowerCase()))
                .map((v, i) => (
                  <div 
                    key={i} 
                    className="flex flex-col gap-1.5 p-2.5 bg-[#252526] border border-[#333] rounded-lg cursor-pointer hover:border-[#555] hover:bg-[#2a2a2b] transition-all group"
                    onClick={() => {
                      navigator.clipboard.writeText(v.key);
                      showToast("Copied to clipboard!");
                    }}
                    title="Click to copy template tag"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-white font-semibold">{v.key}</span>
                      <Copy size={14} className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <span className="text-xs text-gray-400 line-clamp-2">{v.value || <i className="text-gray-600">empty</i>}</span>
                  </div>
              ))}
              {getAvailableVariables().length === 0 && (
                <div className="text-center text-sm text-gray-500 py-4">No variables found on this page.</div>
              )}
            </div>
          </div>
        )}

        {currentView === "clipper" && (
          selectedDestObj?.type === "database" && dbProperties ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#333] pb-2">
                <label className="text-xs font-semibold text-white uppercase tracking-wider">Live Clip Properties</label>
                {selectedTemplateId && (
                  <span className="text-[10px] text-white bg-[#333] px-2 py-0.5 rounded border border-[#555]">
                    Template: {templates.find(t => t.id === selectedTemplateId)?.name}
                  </span>
                )}
              </div>
              
              {(() => {
                const templateObj = templates.find(t => t.id === selectedTemplateId);
                const allProps = Object.keys(dbProperties);
                const orderedProps = (templateObj?.propertyOrder || []).filter(p => allProps.includes(p));
                const missingProps = allProps.filter(p => !orderedProps.includes(p));
                const finalOrder = [...orderedProps, ...missingProps];

                return finalOrder.map((propName) => {
                  const propDef = dbProperties[propName];
                  const isSelect = propDef.type === "select" || propDef.type === "status";
                  const isMultiSelect = propDef.type === "multi_select";
                  const options = isSelect ? (propDef[propDef.type]?.options || []) : (isMultiSelect ? (propDef.multi_select?.options || []) : []);
                
                let filteredOptions = options;
                let showCreateOption = false;
                let newOptionName = "";
                
                if (openDropdownId === propName && (isSelect || isMultiSelect)) {
                  const currentValue = activeClipData[propName] || "";
                  const segments = currentValue.split(',');
                  const searchTerm = segments[segments.length - 1].trim();
                  const searchTermLower = searchTerm.toLowerCase();
                  const isExactMatch = options.some((o: any) => o.name.toLowerCase() === searchTermLower);
                  
                  if (searchTermLower && !isExactMatch) {
                    filteredOptions = options.filter((opt: any) => opt.name.toLowerCase().includes(searchTermLower));
                    showCreateOption = true;
                    newOptionName = searchTerm;
                  }
                }
                
                    return (
                      <div key={propName} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] tracking-[0.15em] text-gray-400 font-bold uppercase">{propName}</label>
                          {propDef.type === "files" && (
                            <button 
                              onClick={() => handlePickImage(propName)}
                              className="px-3 py-1.5 bg-white text-black hover:bg-gray-200 rounded-full text-xs font-bold transition-all shrink-0 flex items-center gap-1 shadow-sm"
                            >
                              <Plus size={14} strokeWidth={3} /> Pick
                            </button>
                          )}
                        </div>
                        
                        {isMultiSelect ? (
                          <div className="relative">
                            <div className="flex flex-wrap items-center gap-2 p-2 bg-[#252525] rounded-3xl min-h-[48px] border border-transparent focus-within:border-[#444] transition-colors cursor-text"
                                 onClick={() => {
                                   if (openDropdownId !== propName) {
                                     setOpenDropdownId(propName);
                                     setVarSearchQuery("");
                                   }
                                 }}>
                              {(activeClipData[propName] || "").split(',').filter((s: string) => s.trim()).map((tag: string, i: number) => (
                                <span key={i} className="px-3 py-1.5 bg-[#333] rounded-full text-xs text-white flex items-center gap-2 shadow-sm">
                                  {tag.trim()}
                                  <span 
                                    className="text-gray-400 hover:text-white cursor-pointer select-none leading-none mt-[1px]"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const segments = activeClipData[propName].split(',').map((s: string) => s.trim()).filter((s: string) => s);
                                      segments.splice(i, 1);
                                      setActiveClipData({ ...activeClipData, [propName]: segments.join(', ') });
                                    }}
                                  >✕</span>
                                </span>
                              ))}
                              {openDropdownId === propName ? (
                                <input 
                                  autoFocus
                                  value={varSearchQuery}
                                  onChange={(e) => setVarSearchQuery(e.target.value)}
                                  onBlur={() => setTimeout(() => setOpenDropdownId(null), 200)}
                                  className="flex-1 min-w-[100px] bg-transparent border-none text-sm text-gray-200 focus:outline-none placeholder-gray-500 ml-2 py-1"
                                  placeholder="Add tag..."
                                />
                              ) : (
                                <div className="flex-1 min-w-[100px] text-sm text-gray-500 ml-2 py-1 select-none">
                                  {(activeClipData[propName] || "").trim() === "" ? "Add tag..." : ""}
                                </div>
                              )}
                            </div>
                            
                            {openDropdownId === propName && (filteredOptions.length > 0 || showCreateOption) && (
                              <div className="absolute z-50 w-full mt-2 bg-[#2a2a2a] border border-[#333] rounded-2xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto">
                                {filteredOptions.map((opt: any) => (
                                  <div
                                    key={opt.id || opt.name}
                                    className="px-4 py-3 text-sm text-gray-200 hover:bg-[#383838] cursor-pointer transition-colors"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      const current = activeClipData[propName] || "";
                                      const segments = current.split(',').map((s: string) => s.trim()).filter((s: string) => s);
                                      segments.push(opt.name);
                                      setActiveClipData({ ...activeClipData, [propName]: segments.join(', ') });
                                      setOpenDropdownId(null);
                                      setVarSearchQuery("");
                                    }}
                                  >
                                    {opt.name}
                                  </div>
                                ))}
                                {showCreateOption && (
                                  <div
                                    className="px-4 py-3 text-sm text-white hover:bg-[#383838] cursor-pointer italic border-t border-[#444]"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      const current = activeClipData[propName] || "";
                                      const segments = current.split(',').map((s: string) => s.trim()).filter((s: string) => s);
                                      segments.push(newOptionName);
                                      setActiveClipData({ ...activeClipData, [propName]: segments.join(', ') });
                                      setOpenDropdownId(null);
                                      setVarSearchQuery("");
                                    }}
                                  >
                                    Create "{newOptionName}"
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : isSelect || propDef.type === "status" ? (
                          <div className="relative">
                            <div 
                              className="flex items-center justify-between px-4 py-3 bg-[#252525] rounded-full cursor-pointer hover:bg-[#2a2a2a] transition-colors border border-transparent focus-within:border-[#444]"
                              onClick={() => {
                                if (openDropdownId === propName) {
                                  setOpenDropdownId(null);
                                } else {
                                  setOpenDropdownId(propName);
                                  setVarSearchQuery("");
                                }
                              }}
                            >
                              <div className="flex items-center gap-3">
                                {activeClipData[propName] && <div className="w-2.5 h-2.5 rounded-full bg-white"></div>}
                                {openDropdownId === propName ? (
                                  <input 
                                    autoFocus
                                    value={varSearchQuery}
                                    onChange={(e) => setVarSearchQuery(e.target.value)}
                                    onBlur={() => setTimeout(() => setOpenDropdownId(null), 200)}
                                    className="bg-transparent border-none text-sm text-white focus:outline-none placeholder-gray-500 w-full"
                                    placeholder="Search..."
                                  />
                                ) : (
                                  <span className="text-sm text-gray-200">{activeClipData[propName] || <span className="text-gray-500">Select option...</span>}</span>
                                )}
                              </div>
                              <ChevronDown size={16} className="text-gray-500 shrink-0 ml-2" />
                            </div>
                            
                            {openDropdownId === propName && (filteredOptions.length > 0 || showCreateOption) && (
                              <div className="absolute z-50 w-full mt-2 bg-[#2a2a2a] border border-[#333] rounded-2xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto">
                                {filteredOptions.map((opt: any) => (
                                  <div
                                    key={opt.id || opt.name}
                                    className="px-4 py-3 text-sm text-gray-200 hover:bg-[#383838] cursor-pointer flex items-center gap-3 transition-colors"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setActiveClipData({ ...activeClipData, [propName]: opt.name });
                                      setOpenDropdownId(null);
                                    }}
                                  >
                                    <div className={`w-2.5 h-2.5 rounded-full ${activeClipData[propName] === opt.name ? 'bg-white' : 'bg-[#444]'}`}></div>
                                    {opt.name}
                                  </div>
                                ))}
                                {showCreateOption && (
                                  <div
                                    className="px-4 py-3 text-sm text-white hover:bg-[#383838] cursor-pointer italic border-t border-[#444]"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setActiveClipData({ ...activeClipData, [propName]: newOptionName });
                                      setOpenDropdownId(null);
                                    }}
                                  >
                                    Create "{newOptionName}"
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : propDef.type === "url" ? (
                          <div className="flex items-center gap-3 px-4 py-3 bg-[#252525] rounded-full focus-within:border-[#444] border border-transparent transition-colors">
                            <Link size={16} className="text-gray-500 shrink-0" />
                            <input 
                              type="text" 
                              value={activeClipData[propName] ?? ""}
                              onChange={(e) => setActiveClipData({ ...activeClipData, [propName]: e.target.value })}
                              className="flex-1 bg-transparent border-none text-sm text-gray-300 focus:outline-none"
                              placeholder="https://"
                            />
                          </div>
                        ) : propDef.type === "files" ? (
                          <div className="bg-[#252525] p-3 rounded-3xl space-y-3">
                            <div className="flex items-center gap-3 px-4 py-3 bg-[#1e1e1e] rounded-full focus-within:border-[#444] border border-transparent transition-colors">
                              <ImageIcon size={16} className="text-gray-500 shrink-0" />
                              <input 
                                type="text" 
                                value={activeClipData[propName] ?? ""}
                                onChange={(e) => setActiveClipData({ ...activeClipData, [propName]: e.target.value })}
                                className="flex-1 bg-transparent border-none text-sm text-gray-300 focus:outline-none placeholder-gray-600"
                                placeholder="Paste image URL..."
                              />
                            </div>
                            
                            {articleData?.allImages && articleData.allImages.length > 0 && (
                              <div className="flex gap-3 overflow-x-auto pb-1 px-1 scrollbar-thin scrollbar-thumb-[#444] scrollbar-track-transparent">
                                {articleData.allImages.map((src, idx) => (
                                  <div 
                                    key={idx}
                                    onClick={() => setActiveClipData({ ...activeClipData, [propName]: src })}
                                    className={`relative h-28 w-20 shrink-0 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 border-[3px] ${activeClipData[propName] === src ? 'border-white opacity-100 scale-105 shadow-xl' : 'border-transparent opacity-60 hover:opacity-100 bg-[#333]'}`}
                                  >
                                    <img src={src} className="w-full h-full object-cover" alt="Gallery" />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : propDef.type === "checkbox" ? (
                          <div className="flex items-center gap-3 px-4 py-3 bg-[#252525] rounded-full focus-within:border-[#444] border border-transparent transition-colors">
                            <input 
                              type="checkbox"
                              checked={activeClipData[propName] === "true"}
                              onChange={(e) => setActiveClipData({ ...activeClipData, [propName]: e.target.checked ? "true" : "false" })}
                              className="w-4 h-4 rounded border-gray-500 text-white focus:ring-white bg-[#1e1e1e]"
                            />
                            <span className="text-sm text-gray-300">Enabled</span>
                          </div>
                        ) : propDef.type === "date" ? (
                          <div className="flex items-center gap-3 px-4 py-3 bg-[#252525] rounded-full focus-within:border-[#444] border border-transparent transition-colors">
                            <Calendar size={16} className="text-gray-500 shrink-0" />
                            <input 
                              type="text" 
                              value={activeClipData[propName] ?? ""}
                              onChange={(e) => setActiveClipData({ ...activeClipData, [propName]: e.target.value })}
                              className="flex-1 bg-transparent border-none text-sm text-gray-300 focus:outline-none placeholder-gray-600"
                              placeholder="YYYY-MM-DD (or leave empty)"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 px-4 py-3 bg-[#252525] rounded-full focus-within:border-[#444] border border-transparent transition-colors">
                            <input 
                              type="text" 
                              value={activeClipData[propName] ?? ""}
                              onChange={(e) => setActiveClipData({ ...activeClipData, [propName]: e.target.value })}
                              className="flex-1 bg-transparent border-none text-sm text-gray-300 focus:outline-none"
                              placeholder="Empty"
                            />
                            {propDef.type === "number" ? <span className="text-gray-500 font-mono text-xs">#</span> : <ChevronsUpDown size={16} className="text-gray-500" />}
                          </div>
                        )}
                      </div>
                    );
              })})()}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Title</label>
                <input 
                  type="text" 
                  value={titleStr}
                  onChange={(e) => setTitleStr(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#555] focus:ring-1 focus:ring-[#555]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">URL</label>
                <input 
                  type="text" 
                  value={urlStr}
                  onChange={(e) => setUrlStr(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none focus:border-[#555] focus:ring-1 focus:ring-[#555]"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Content Preview</label>
                  <span className="text-xs text-white bg-[#333] px-2 py-0.5 rounded">Markdown</span>
                </div>
                <div className="w-full h-32 bg-[#1a1a1a] border border-[#333] rounded-lg p-3 text-xs text-gray-400 overflow-y-auto font-mono whitespace-pre-wrap">
                  {articleData?.markdown ? articleData.markdown.substring(0, 500) + "..." : "Loading..."}
                </div>
              </div>
            </div>
          )
        )}
      </main>

      <div className="absolute bottom-0 left-0 right-0 p-6 pt-12 bg-gradient-to-t from-[#161616] via-[#161616] to-transparent pointer-events-none z-50">
        <div className="pointer-events-auto">
          <button 
            onClick={handleSaveToNotion}
            disabled={!articleData || !selectedDestination || isClipping || clipSuccess}
            className={`w-full py-3.5 px-4 rounded-full font-bold flex items-center justify-center gap-2 transition-all shadow-2xl ${
              clipSuccess ? "bg-white text-black hover:bg-gray-200" :
              isClipping || !articleData || !selectedDestination ? "bg-gray-300 cursor-not-allowed text-gray-500" : 
              "bg-white text-black hover:bg-gray-200"
            }`}
          >
            {clipSuccess ? (
              <><Check size={20} strokeWidth={2.5} /> Saved to Notion</>
            ) : isClipping ? (
              <><Loader2 className="animate-spin" size={20} strokeWidth={2.5} /> Clipping...</>
            ) : (
              <><Save size={20} strokeWidth={2.5} /> Save to Notion</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;

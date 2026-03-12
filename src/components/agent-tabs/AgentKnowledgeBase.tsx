import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Plus, BookOpen, FileText, Globe, Trash2, MessageSquare, Upload, Link } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

type ContentTab = "files" | "urls";

interface Props {
  agentId: string;
  userId: string;
}

export default function AgentKnowledgeBase({ agentId, userId }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<Tables<"knowledge_base_items">[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contentTab, setContentTab] = useState<ContentTab>("files");
  const [files, setFiles] = useState<File[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    const { data } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel(`kb-agent-${agentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_base_items" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agentId]);

  const resetForm = () => {
    setName(""); setDescription(""); setContentTab("files"); setFiles([]); setWebsiteUrl("");
  };

  const handleSubmit = async () => {
    if (!name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);

    if (contentTab === "files" && files.length > 0) {
      for (const file of files) {
        const path = `${userId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("knowledge-documents").upload(path, file);
        if (uploadError) {
          toast({ title: "Upload error", description: uploadError.message, variant: "destructive" });
          setSaving(false);
          return;
        }
        const { error } = await supabase.from("knowledge_base_items").insert({
          agent_id: agentId, user_id: userId, type: "document", title: name, content: description || null, file_path: path,
        });
        if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }
      }
    } else if (contentTab === "urls" && websiteUrl) {
      const { error } = await supabase.from("knowledge_base_items").insert({
        agent_id: agentId, user_id: userId, type: "website", title: name, content: description || null, website_url: websiteUrl,
      });
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }
    } else if (description) {
      const { error } = await supabase.from("knowledge_base_items").insert({
        agent_id: agentId, user_id: userId, type: "text", title: name, content: description,
      });
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }
    } else {
      toast({ title: "Missing content", description: "Upload files, add a URL, or enter a description.", variant: "destructive" });
      setSaving(false);
      return;
    }

    toast({ title: "Knowledge base created" });
    resetForm();
    setDialogOpen(false);
    setSaving(false);
  };

  const deleteItem = async (id: string) => {
    await supabase.from("knowledge_base_items").delete().eq("id", id);
    fetchData();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(f => /\.(pdf|txt|doc|docx|md)$/i.test(f.name) && f.size <= 10 * 1024 * 1024);
    setFiles(prev => [...prev, ...dropped]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files).filter(f => /\.(pdf|txt|doc|docx|md)$/i.test(f.name) && f.size <= 10 * 1024 * 1024);
      setFiles(prev => [...prev, ...selected]);
    }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case "document": return <BookOpen className="h-4 w-4" />;
      case "website": return <Globe className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Knowledge this agent can reference during calls.</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-2" />Add Knowledge</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>Add Knowledge Base</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label className="font-semibold">Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Enter knowledge base name" />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold">Description (Optional)</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Enter description" rows={3} />
              </div>
              <Separator />
              <div className="space-y-3">
                <Label className="font-semibold">Content</Label>
                <div className="grid grid-cols-2 rounded-lg border bg-muted/40 p-1">
                  <button type="button" onClick={() => setContentTab("files")}
                    className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${contentTab === "files" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    <FileText className="h-4 w-4" /> Files
                  </button>
                  <button type="button" onClick={() => setContentTab("urls")}
                    className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${contentTab === "urls" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    <Link className="h-4 w-4" /> URLs
                  </button>
                </div>
                {contentTab === "files" && (
                  <div className="space-y-3">
                    <div onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 py-10 px-4 cursor-pointer hover:border-muted-foreground/50 transition-colors">
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm"><span className="font-semibold">Upload files</span> <span className="text-muted-foreground">or drag and drop</span></p>
                      <p className="text-xs text-muted-foreground">PDF, TXT, DOC, DOCX, MD up to 10MB</p>
                      <input ref={fileInputRef} type="file" className="hidden" multiple accept=".pdf,.txt,.doc,.docx,.md" onChange={handleFileSelect} />
                    </div>
                    {files.length > 0 && (
                      <div className="space-y-2">
                        {files.map((f, i) => (
                          <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="truncate">{f.name}</span>
                              <span className="text-xs text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                            </div>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {contentTab === "urls" && (
                  <Input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://example.com" type="url" />
                )}
              </div>
              <Separator />
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => { resetForm(); setDialogOpen(false); }}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={saving || !name}>{saving ? "Creating..." : "Add Knowledge"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2].map(i => <Card key={i} className="animate-pulse"><CardContent className="p-6 h-16" /></Card>)}</div>
      ) : items.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12">
          <BookOpen className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No knowledge items yet. Add documents, URLs or text.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <Card key={item.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">{typeIcon(item.type)}</div>
                  <div>
                    <p className="font-medium text-sm">{item.title}</p>
                    <Badge variant="outline" className="text-xs">{item.type}</Badge>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteItem(item.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

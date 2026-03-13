import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Plus, BookOpen, FileText, Globe, Trash2, MessageSquare, Upload, Link, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

type ContentTab = "files" | "urls";

interface KBItem {
  id: string;
  agent_id: string;
  user_id: string;
  type: string;
  title: string;
  content: string | null;
  file_path: string | null;
  website_url: string | null;
  processing_status: string | null;
  created_at: string;
  updated_at: string;
}

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Tables<"knowledge_base_items">[]>([]);
  const [agents, setAgents] = useState<Tables<"agents">[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [contentTab, setContentTab] = useState<ContentTab>("files");
  const [files, setFiles] = useState<File[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    if (!user) return;
    const [itemsRes, agentsRes] = await Promise.all([
      supabase.from("knowledge_base_items").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("*"),
    ]);
    setItems(itemsRes.data || []);
    setAgents(agentsRes.data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('knowledge-base-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'knowledge_base_items' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setAgentId("");
    setContentTab("files");
    setFiles([]);
    setWebsiteUrl("");
  };

  const handleSubmit = async () => {
    if (!user || !agentId || !name) {
      toast({ title: "Missing fields", description: "Name and Agent are required.", variant: "destructive" });
      return;
    }
    setSaving(true);

    if (contentTab === "files" && files.length > 0) {
      for (const file of files) {
        const ext = file.name.split(".").pop();
        const path = `${user.id}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("knowledge-documents")
          .upload(path, file);
        if (uploadError) {
          toast({ title: "Upload error", description: uploadError.message, variant: "destructive" });
          setSaving(false);
          return;
        }
        const { error } = await supabase.from("knowledge_base_items").insert({
          agent_id: agentId,
          user_id: user.id,
          type: "document",
          title: name,
          content: description || null,
          file_path: path,
        });
        if (error) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
          setSaving(false);
          return;
        }
      }
    } else if (contentTab === "urls" && websiteUrl) {
      const { error } = await supabase.from("knowledge_base_items").insert({
        agent_id: agentId,
        user_id: user.id,
        type: "website",
        title: name,
        content: description || null,
        website_url: websiteUrl,
      });
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    } else if (description) {
      const { error } = await supabase.from("knowledge_base_items").insert({
        agent_id: agentId,
        user_id: user.id,
        type: "text",
        title: name,
        content: description,
      });
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    } else {
      toast({ title: "Missing content", description: "Please upload files, add a URL, or enter a description.", variant: "destructive" });
      setSaving(false);
      return;
    }

    toast({ title: "Knowledge base created" });
    resetForm();
    setDialogOpen(false);
    setSaving(false);
    fetchData();
  };

  const deleteItem = async (id: string) => {
    await supabase.from("knowledge_base_items").delete().eq("id", id);
    fetchData();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(pdf|txt|doc|docx|md)$/i.test(f.name) && f.size <= 10 * 1024 * 1024
    );
    setFiles((prev) => [...prev, ...dropped]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files).filter((f) =>
        /\.(pdf|txt|doc|docx|md)$/i.test(f.name) && f.size <= 10 * 1024 * 1024
      );
      setFiles((prev) => [...prev, ...selected]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case "text": return <FileText className="h-4 w-4" />;
      case "faq": return <MessageSquare className="h-4 w-4" />;
      case "document": return <BookOpen className="h-4 w-4" />;
      case "website": return <Globe className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const agentName = (agId: string) => agents.find((a) => a.id === agId)?.name || "Unknown";

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
            <p className="text-muted-foreground mt-1">Add information your receptionists can reference.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Knowledge</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">Create Knowledge Base</DialogTitle>
              </DialogHeader>

              <div className="space-y-5 pt-2">
                {/* Agent */}
                <div className="space-y-2">
                  <Label className="font-semibold">Agent</Label>
                  <Select value={agentId} onValueChange={setAgentId}>
                    <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Name */}
                <div className="space-y-2">
                  <Label className="font-semibold">Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter knowledge base name"
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label className="font-semibold">Description (Optional)</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Enter description"
                    rows={3}
                  />
                </div>

                <Separator />

                {/* Content */}
                <div className="space-y-3">
                  <Label className="font-semibold">Content</Label>

                  {/* Tabs */}
                  <div className="grid grid-cols-2 rounded-lg border bg-muted/40 p-1">
                    <button
                      type="button"
                      onClick={() => setContentTab("files")}
                      className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        contentTab === "files"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <FileText className="h-4 w-4" /> Files
                    </button>
                    <button
                      type="button"
                      onClick={() => setContentTab("urls")}
                      className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        contentTab === "urls"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Link className="h-4 w-4" /> URLs
                    </button>
                  </div>

                  {contentTab === "files" && (
                    <div className="space-y-3">
                      {/* Drop zone */}
                      <div
                        onDrop={handleDrop}
                        onDragOver={(e) => e.preventDefault()}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 py-10 px-4 cursor-pointer hover:border-muted-foreground/50 transition-colors"
                      >
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm">
                          <span className="font-semibold">Upload files</span>{" "}
                          <span className="text-muted-foreground">or drag and drop</span>
                        </p>
                        <p className="text-xs text-muted-foreground">PDF, TXT, DOC, DOCX, MD up to 10MB</p>
                        <p className="text-xs text-muted-foreground">Multiple files supported</p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          multiple
                          accept=".pdf,.txt,.doc,.docx,.md"
                          onChange={handleFileSelect}
                        />
                      </div>
                      {/* File list */}
                      {files.length > 0 && (
                        <div className="space-y-2">
                          {files.map((f, i) => (
                            <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                <span className="truncate">{f.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {(f.size / 1024).toFixed(0)} KB
                                </span>
                              </div>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(i)}>
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {contentTab === "urls" && (
                    <div className="space-y-2">
                      <Input
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="https://example.com"
                        type="url"
                      />
                    </div>
                  )}
                </div>

                <Separator />

                {/* Footer */}
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => { resetForm(); setDialogOpen(false); }}>Cancel</Button>
                  <Button onClick={handleSubmit} disabled={saving || !agentId || !name}>
                    <Plus className="h-4 w-4 mr-2" />
                    {saving ? "Creating..." : "Create Knowledge Base"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse"><CardContent className="p-6 h-20" /></Card>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No knowledge items yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Add text, FAQs, documents, or website URLs.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                      {typeIcon(item.type)}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{item.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-xs">{item.type}</Badge>
                        <span className="text-xs text-muted-foreground">{agentName(item.agent_id)}</span>
                      </div>
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
    </DashboardLayout>
  );
}

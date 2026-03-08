import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, BookOpen, FileText, Globe, Trash2, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Tables<"knowledge_base_items">[]>([]);
  const [agents, setAgents] = useState<Tables<"agents">[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    agent_id: "",
    type: "text" as string,
    title: "",
    content: "",
    website_url: "",
  });
  const [file, setFile] = useState<File | null>(null);

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

  useEffect(() => { fetchData(); }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !form.agent_id) return;

    let filePath: string | null = null;

    if (form.type === "document" && file) {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("knowledge-documents")
        .upload(path, file);
      if (uploadError) {
        toast({ title: "Upload error", description: uploadError.message, variant: "destructive" });
        return;
      }
      filePath = path;
    }

    const { error } = await supabase.from("knowledge_base_items").insert({
      agent_id: form.agent_id,
      user_id: user.id,
      type: form.type,
      title: form.title,
      content: form.type === "text" || form.type === "faq" ? form.content : null,
      website_url: form.type === "website" ? form.website_url : null,
      file_path: filePath,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Knowledge added" });
      setDialogOpen(false);
      setForm({ agent_id: form.agent_id, type: "text", title: "", content: "", website_url: "" });
      setFile(null);
      fetchData();
    }
  };

  const deleteItem = async (id: string) => {
    await supabase.from("knowledge_base_items").delete().eq("id", id);
    fetchData();
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

  const agentName = (agentId: string) => agents.find((a) => a.id === agentId)?.name || "Unknown";

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
                <DialogTitle>Add Knowledge</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Agent</Label>
                  <Select value={form.agent_id} onValueChange={(val) => setForm({ ...form, agent_id: val })}>
                    <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(val) => setForm({ ...form, type: val })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text / Info</SelectItem>
                      <SelectItem value="faq">FAQ</SelectItem>
                      <SelectItem value="document">Document Upload</SelectItem>
                      <SelectItem value="website">Website URL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. Business Hours"
                    required
                  />
                </div>
                {(form.type === "text" || form.type === "faq") && (
                  <div className="space-y-2">
                    <Label>Content</Label>
                    <Textarea
                      value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                      placeholder={form.type === "faq" ? "Q: What are your hours?\nA: We are open 9-5 M-F." : "Enter information..."}
                      rows={5}
                    />
                  </div>
                )}
                {form.type === "website" && (
                  <div className="space-y-2">
                    <Label>Website URL</Label>
                    <Input
                      value={form.website_url}
                      onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                      placeholder="https://example.com"
                      type="url"
                    />
                  </div>
                )}
                {form.type === "document" && (
                  <div className="space-y-2">
                    <Label>Upload Document</Label>
                    <Input
                      type="file"
                      accept=".pdf,.doc,.docx,.txt"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={!form.agent_id}>
                  Add Knowledge
                </Button>
              </form>
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

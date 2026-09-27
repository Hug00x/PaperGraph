"use client";
import { useState } from "react";
import { GraphPane } from "@/components/graph-pane";
import type { GraphZone } from "@/lib/graph-zones";
import type { ArticlePosition, WorkspaceArticle } from "@/lib/workspace-data";
const baseArticles: WorkspaceArticle[] = ["A", "B", "C"].map(id => ({ id, title: `Paper ${id}`, author: "Test", status: "Published", tags: [], updatedAt: "", source: "" }));
const initial = { A: { x: 46, y: 48 }, B: { x: 52, y: 48 }, C: { x: 62, y: 60 } };
export default function Fixture() {
 const [articles, setArticles] = useState(baseArticles);
 const [canEdit, setCanEdit] = useState(true);
 const [zones, setZones] = useState<GraphZone[]>([]);
 const [positions, setPositions] = useState<Record<string, ArticlePosition>>(initial);
 const [active, setActive] = useState<string|null>(null);
 const [reload, setReload] = useState(0);
 const [writes, setWrites] = useState(0);
 const commit = (z: GraphZone[], p: Record<string, ArticlePosition>) => { setZones(z); setPositions(p); setWrites(n=>n+1); localStorage.setItem("zones-fixture",JSON.stringify({zones:z,positions:p})); };
 return <main className="papergraph-app flex h-screen w-screen" data-testid="fixture">
 <output id="fixture-state" style={{display:"none"}}>{JSON.stringify({zones,positions,writes})}</output>
 <button id="restore-fixture" style={{display:"none"}} onClick={()=>{const s=JSON.parse(localStorage.getItem("zones-fixture")!);setZones(s.zones);setPositions(s.positions);setReload(n=>n+1);}}>Restore</button>
 <button id="readonly-fixture" style={{display:"none"}} onClick={()=>setCanEdit(false)}>Read only</button>
 <button id="dense-fixture" style={{display:"none"}} onClick={()=>{
   const extra = Array.from({length:150},(_,i)=>({...baseArticles[0],id:`dense-${i}`,title:`Dense paper ${i}`}));
   setArticles([...baseArticles,...extra]);
   setPositions(p=>({...p,...Object.fromEntries(extra.map((a,i)=>[a.id,{x:34+(i%15)*3,y:25+Math.floor(i/15)*4}]))}));
 }}>Dense</button>
 <GraphPane key={reload} workspaceId="" accessToken="" articles={articles} activeArticle={articles.find(a=>a.id===active)??null} language="en" relations={articles.slice(1).map((article,i)=>({id:`r-${i}`,fromArticleId:"A",toArticleId:article.id,relationType:i%2 ? "semantic" : "citation",note:"",createdAt:""}))}
 zones={zones} onZonesChange={commit} articlePositions={positions} onArticlePositionsChange={p=>commit(zones,p)}
 onSelectArticle={setActive} canEdit={canEdit} unlinkedMentions={[]} onAddRecommendation={async()=>{}}
 onCreateRelation={()=>{}} onRemoveRelation={()=>{}} onCreateWikilinkFromMention={()=>{}} onIgnoreUnlinkedMention={()=>{}}
 onEditArticle={()=>{}} onViewArticle={()=>{}} onExportArticlePdf={()=>{}} onDeleteArticle={()=>{}} onImportPdfArticle={async()=>{throw Error("unused")}} />
 </main>;
}

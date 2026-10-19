import { describe,it,expect,vi,beforeEach,afterEach } from "vitest";
import { renderHook,act } from "@testing-library/react";
import { useCloudAutosave,draftKey,readDraft } from "../../client/src/hooks/use-cloud-autosave";
import { createDesignDocument } from "../../shared/design-document";
vi.mock("../../client/src/lib/design-drafts",()=>({writeLargeDraft:vi.fn().mockResolvedValue(undefined),readLargeDraft:vi.fn().mockResolvedValue(null)}));
const doc=()=>({...createDesignDocument(),metadata:{id:"project",name:"Project",cloudVersion:2,cloudOwnerId:"owner"}});
beforeEach(()=>{vi.useFakeTimers();localStorage.clear();sessionStorage.clear();Object.defineProperty(navigator,"onLine",{configurable:true,value:true});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe("cloud autosave",()=>{
 it("keeps account and project drafts separate",()=>{expect(draftKey("a","project")).not.toBe(draftKey("b","project"));expect(draftKey("a","other")).not.toBe(draftKey("a","project"));});
 it("does not upload another account's draft",async()=>{const fetch=vi.fn();vi.stubGlobal("fetch",fetch);renderHook(()=>useCloudAutosave({document:doc(),userId:"different",onSaved:vi.fn()}));await act(()=>vi.advanceTimersByTimeAsync(5000));expect(fetch).not.toHaveBeenCalled();expect(readDraft("different","project")).toBeNull();});
 it("retains a local document and stops cloud writes on conflict",async()=>{const fetch=vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({current:{id:"project",version:3}})});vi.stubGlobal("fetch",fetch);const {result}=renderHook(()=>useCloudAutosave({document:doc(),userId:"owner",onSaved:vi.fn()}));await act(()=>vi.advanceTimersByTimeAsync(2100));expect(result.current.status).toBe("Conflict");expect(readDraft("owner","project").metadata.cloudVersion).toBe(2);await act(()=>vi.advanceTimersByTimeAsync(20000));expect(fetch).toHaveBeenCalledTimes(1);});
 it("stops repeated unauthorized autosaves",async()=>{const fetch=vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({error:"sign in"})});vi.stubGlobal("fetch",fetch);const {result}=renderHook(()=>useCloudAutosave({document:doc(),userId:"owner",onSaved:vi.fn()}));await act(()=>vi.advanceTimersByTimeAsync(2100));expect(result.current.status).toBe("Sign-in required");await act(()=>vi.advanceTimersByTimeAsync(20000));expect(fetch).toHaveBeenCalledTimes(1);});
 it("reuses the request id and expected version after uncertain network failures",async()=>{const fetch=vi.fn().mockRejectedValue(new Error("network"));vi.stubGlobal("fetch",fetch);renderHook(()=>useCloudAutosave({document:doc(),userId:"owner",onSaved:vi.fn()}));await act(()=>vi.advanceTimersByTimeAsync(2100));await act(()=>vi.advanceTimersByTimeAsync(4000));const first=JSON.parse(fetch.mock.calls[0][1].body);const second=JSON.parse(fetch.mock.calls[1][1].body);expect(first.requestId).toBe(second.requestId);expect(first.expectedVersion).toBe(2);});
});

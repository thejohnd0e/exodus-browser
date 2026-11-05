import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {CdpClient} from '../../src/main/cdp/client';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

interface DisplayMode{device:string;name:string;position:[number,number];size:[number,number];orientation:number;frequency:number;bitsPerPel:number}

/**
 * Reports the current mode of every attached desktop display without touching any setting:
 * resolution, refresh rate, orientation and position come from DEVMODE (EnumDisplaySettings).
 */
const probe=String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DisplayProbe
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public ushort dmSpecVersion;
        public ushort dmDriverVersion;
        public ushort dmSize;
        public ushort dmDriverExtra;
        public uint dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public uint dmDisplayOrientation;
        public uint dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel;
        public uint dmPelsWidth;
        public uint dmPelsHeight;
        public uint dmDisplayFlags;
        public uint dmDisplayFrequency;
        public uint dmICMMethod;
        public uint dmICMIntent;
        public uint dmMediaType;
        public uint dmDitherType;
        public uint dmReserved1;
        public uint dmReserved2;
        public uint dmPanningWidth;
        public uint dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplayDevices(string device, uint devNum, ref DISPLAY_DEVICE displayDevice, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    const int DISPLAY_DEVICE_ATTACHED_TO_DESKTOP = 0x00000001;

    static void Escape(StringBuilder sb, string value)
    {
        sb.Append('"');
        foreach (char c in value)
        {
            if (c == '"' || c == '\\') sb.Append('\\');
            if (c < ' ') { sb.Append("\\u").Append(((int)c).ToString("x4")); }
            else sb.Append(c);
        }
        sb.Append('"');
    }

    public static string List()
    {
        var entries = new List<string>();
        var device = new DISPLAY_DEVICE();
        device.cb = Marshal.SizeOf(device);
        for (uint i = 0; EnumDisplayDevices(null, i, ref device, 0); i++)
        {
            if ((device.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) == 0) { device = new DISPLAY_DEVICE(); device.cb = Marshal.SizeOf(device); continue; }
            var settings = new DEVMODE();
            settings.dmSize = (ushort)Marshal.SizeOf(settings);
            if (!EnumDisplaySettings(device.DeviceName, -1, ref settings)) { device = new DISPLAY_DEVICE(); device.cb = Marshal.SizeOf(device); continue; }
            var sb = new StringBuilder();
            sb.Append("{\"device\":"); Escape(sb, device.DeviceName);
            sb.Append(",\"name\":"); Escape(sb, device.DeviceString);
            sb.Append(",\"position\":[").Append(settings.dmPositionX).Append(',').Append(settings.dmPositionY).Append(']');
            sb.Append(",\"size\":[").Append(settings.dmPelsWidth).Append(',').Append(settings.dmPelsHeight).Append(']');
            sb.Append(",\"orientation\":").Append(settings.dmDisplayOrientation);
            sb.Append(",\"frequency\":").Append(settings.dmDisplayFrequency);
            sb.Append(",\"bitsPerPel\":").Append(settings.dmBitsPerPel);
            sb.Append('}');
            entries.Add(sb.ToString());
            device = new DISPLAY_DEVICE();
            device.cb = Marshal.SizeOf(device);
        }
        return "[" + string.Join(",", entries) + "]";
    }
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[DisplayProbe]::List()
`;

function readDisplays(directory:string):DisplayMode[]{
  const file=join(directory,'display-probe.ps1');
  writeFileSync(file,probe);
  const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file],{encoding:'utf8',windowsHide:true,timeout:60000});
  return (JSON.parse(output.trim()) as DisplayMode[]).sort((a,b)=>a.device.localeCompare(b.device));
}

function listen(server:ReturnType<typeof createServer>){return new Promise<number>(resolve=>{server.listen(0,'127.0.0.1',()=>resolve((server.address() as AddressInfo).port));});}

it.skipIf(process.platform!=='win32')('browser emulation leaves the desktop display configuration untouched',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const directory=mkdtempSync(join(tmpdir(),'exodus-display-config-'));
  const before=readDisplays(directory);
  expect(before.length,'no attached desktop display was reported').toBeGreaterThan(0);
  const width=before[0]!.size[0]-640>=800?before[0]!.size[0]-640:before[0]!.size[0]+640;
  const height=before[0]!.size[1]-360>=600?before[0]!.size[1]-360:before[0]!.size[1]+360;

  const reports:Array<{tag:string}>=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>fetch('/report?value='+encodeURIComponent(JSON.stringify({tag:'${req.url}'})));</script>`);
  });
  const port=await listen(server);
  const root=tempRoot();let client:CdpClient|null=null;
  try{
    const p=await new ChromiumAdapter(exe,(a,b)=>{client=CdpClient.fromPipe(a,b);return client;}).launch({profileId:'display-config',userDataDir:root,languages:['en-US'],startUrls:[`http://127.0.0.1:${port}/first`],fingerprint:{...DEFAULT_FINGERPRINT,screen:{mode:'manual',width,height}}});
    try{
      for(let i=0;i<100&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));
      const {targetInfos}=await client!.send<{targetInfos:Array<{targetId:string;type:string}>}>('Target.getTargets',{});
      const target=targetInfos.find(t=>t.type==='page')!;
      const {sessionId}=await client!.send<{sessionId:string}>('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      const {windowId}=await client!.send<{windowId:number}>('Browser.getWindowForTarget',{targetId:target.targetId});
      await client!.send('Browser.setWindowBounds',{windowId,bounds:{width:900,height:650}});
      await client!.send('Page.navigate',{url:`http://127.0.0.1:${port}/second`},sessionId);
      await new Promise(r=>setTimeout(r,500));
      await client!.send('Page.reload',{},sessionId);
      await new Promise(r=>setTimeout(r,500));
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}

  const after=readDisplays(directory);
  rmSync(directory,{recursive:true,force:true});
  expect(after).toEqual(before);
},120000);

// FloatingCloud 0.4.x — experimental BetterNCM WebView2 transparent lyric host.
// Renderer-process only. No DesktopLyrics hooks, no patching or global interception.
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <d3d11.h>
#include <dcomp.h>
#include <dxgi.h>
#include <WebView2.h>
#include <wrl.h>
#include <atomic>
#include <algorithm>
#include <memory>
#include <cstring>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <mutex>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Callback;

namespace fc {
constexpr UINT kFrame = WM_APP + 101;
constexpr UINT kLyrics = WM_APP + 102;
constexpr UINT kSettings = WM_APP + 103;
constexpr UINT kVisible = WM_APP + 104;
constexpr UINT kLock = WM_APP + 105;
constexpr UINT kResize = WM_APP + 106;
constexpr UINT kShutdown = WM_APP + 107;
// The lyric surface handles mouse gestures at Win32 level; WebView2 receives toolbar clicks.

HMODULE module = nullptr;
std::mutex gate;
HANDLE worker = nullptr;
HANDLE createdEvent = nullptr;
std::atomic<HWND> hwnd{nullptr};
std::atomic<int> state{0}; // 0 idle, 1 starting, 2 running, 3 error
std::atomic<int> requestedAction{0}; // 1 prev, 2 toggle, 3 next, 4 close, 5 lock
bool locked = false; // accessed only from window thread
bool lyricPointerDown=false, lyricDidDrag=false;
bool settingsPopupOpen=false;
bool controlsVisible=false;
POINT dragStartScreen{};
POINT dragWindowOrigin{};
bool visible = false;
bool webReady = false;
int width = 740;
int height = 165;
std::string latestSettings = "{}";
std::string latestLyrics = "{}";
std::string latestFrame = "{}";
ComPtr<IDCompositionDevice> compositionDevice;
ComPtr<IDCompositionTarget> target;
ComPtr<IDCompositionVisual> visual;
ComPtr<ICoreWebView2CompositionController> compositionController;
ComPtr<ICoreWebView2Controller> controller;
ComPtr<ICoreWebView2> web;

std::wstring toWide(const std::string& s) {
    if (s.empty()) return L"";
    int len=MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr, 0);
    if (!len) return L"";
    std::wstring out(len, L'\0');
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), out.data(), len)) return L"";
    return out;
}
std::wstring desktopHtml() {
    wchar_t buffer[MAX_PATH]{};
    if (!GetModuleFileNameW(module,buffer,MAX_PATH)) return L"";
    std::filesystem::path path(buffer);
    path = path.parent_path()/L"desktop.html";
    std::ifstream f(path, std::ios::binary);
    if (!f) return L"";
    std::string bytes((std::istreambuf_iterator<char>(f)),std::istreambuf_iterator<char>());
    if (bytes.size()>512*1024) return L"";
    return toWide(bytes);
}
void sendToWeb(const char* type, const std::string& payload) {
    if (!webReady || !web) return;
    std::string json=std::string("{\"type\":\"")+type+"\",\"payload\":"+payload+"}";
    std::wstring wide=toWide(json);
    if (!wide.empty()) web->PostWebMessageAsJson(wide.c_str());
}
void sizeController() {
    if (!controller || !hwnd.load()) return;
    RECT r{}; GetClientRect(hwnd.load(),&r);
    controller->put_Bounds(r);
}
void setLock(bool lock) {
    locked = lock;
    HWND window=hwnd.load();
    if (!window) return;
    LONG_PTR style=GetWindowLongPtrW(window,GWL_EXSTYLE);
    // HTTRANSPARENT only forwards to same-thread windows. A layered + transparent
    // top-level window is required to let clicks reach other processes.
    // Keep WS_EX_NOREDIRECTIONBITMAP for the DirectComposition visual tree;
    // the layered+composition combination must be verified on the target OS.
    if (lock) style |= WS_EX_LAYERED | WS_EX_TRANSPARENT;
    else style &= ~(static_cast<LONG_PTR>(WS_EX_TRANSPARENT) | WS_EX_LAYERED);
    SetWindowLongPtrW(window,GWL_EXSTYLE,style);
    if(lock) SetLayeredWindowAttributes(window,0,255,LWA_ALPHA);
    SetWindowPos(window,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE|SWP_FRAMECHANGED);
    sendToWeb("locked",lock?"true":"false");
}
void closeWeb() {
    webReady = false;
    if (controller) controller->Close();
    web.Reset(); controller.Reset(); compositionController.Reset();
    visual.Reset();target.Reset();compositionDevice.Reset();
}
void webReceived(ICoreWebView2WebMessageReceivedEventArgs* args) {
    if (!args) return;
    LPWSTR str=nullptr;
    if (FAILED(args->TryGetWebMessageAsString(&str))||!str) return;
    std::wstring cmd(str);
    CoTaskMemFree(str);
    if (cmd==L"controlsOpen") controlsVisible=true;
    else if (cmd==L"controlsClosed") {controlsVisible=false;settingsPopupOpen=false;}
    else if (cmd==L"settingsOpen") settingsPopupOpen=true;
    else if (cmd==L"settingsClosed") settingsPopupOpen=false;
    else if (cmd==L"seekBack") requestedAction.store(6);
    else if (cmd==L"seekForward") requestedAction.store(7);
    else if (cmd==L"fontSmaller") requestedAction.store(8);
    else if (cmd==L"fontLarger") requestedAction.store(9);
    else if (cmd==L"previous") requestedAction.store(1);
    else if (cmd==L"toggle") requestedAction.store(2);
    else if (cmd==L"next") requestedAction.store(3);
    else if (cmd==L"close") {
        requestedAction.store(4); visible=false;
        ShowWindow(hwnd.load(),SW_HIDE);
    } else if (cmd==L"lock") {
        requestedAction.store(5);setLock(true);
    }
}
void initWebView() {
    // Request an IDXGIDevice for DirectComposition.
    ComPtr<ID3D11Device> d3d;
    if (FAILED(D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,
        &d3d,nullptr,nullptr))) {state.store(3);return;}
    ComPtr<IDXGIDevice> dxgi;
    if (FAILED(d3d.As(&dxgi)) || FAILED(DCompositionCreateDevice(dxgi.Get(),IID_PPV_ARGS(&compositionDevice)))) {state.store(3);return;}
    HWND h=hwnd.load();
    if (FAILED(compositionDevice->CreateTargetForHwnd(h,TRUE,&target)) ||
        FAILED(compositionDevice->CreateVisual(&visual)) ||
        FAILED(target->SetRoot(visual.Get())) || FAILED(compositionDevice->Commit())) {state.store(3);return;}
    wchar_t appdata[MAX_PATH]{};
    DWORD chars=GetEnvironmentVariableW(L"LOCALAPPDATA",appdata,MAX_PATH);
    std::wstring profile = chars && chars<MAX_PATH ? std::wstring(appdata)+L"\\FloatingCloud-WebView2" : L"";
    HRESULT hr=CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.empty()?nullptr:profile.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [](HRESULT result, ICoreWebView2Environment* env)->HRESULT {
                ComPtr<ICoreWebView2Environment3> env3;
                if (FAILED(result)||!env||FAILED(env->QueryInterface(IID_PPV_ARGS(&env3)))) {state.store(3);return S_OK;}
                return env3->CreateCoreWebView2CompositionController(hwnd.load(),
                    Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
                        [](HRESULT error, ICoreWebView2CompositionController* comp)->HRESULT {
                            if (FAILED(error)||!comp) {state.store(3);return S_OK;}
                            compositionController=comp;
                            if (FAILED(compositionController.As(&controller)) ||
                                FAILED(controller->get_CoreWebView2(&web)) ||
                                FAILED(compositionController->put_RootVisualTarget(visual.Get()))) {state.store(3);return S_OK;}
                            ComPtr<ICoreWebView2Controller2> ctrl2;
                            if (SUCCEEDED(controller.As(&ctrl2))) {
                                COREWEBVIEW2_COLOR transparent{0,0,0,0};
                                ctrl2->put_DefaultBackgroundColor(transparent);
                            }
                            controller->put_IsVisible(TRUE);
                            sizeController();
                            compositionDevice->Commit();
                            ComPtr<ICoreWebView2Settings> setting;
                            if (SUCCEEDED(web->get_Settings(&setting))) {
                                setting->put_AreDevToolsEnabled(FALSE);
                                setting->put_AreDefaultContextMenusEnabled(FALSE);
                            }
                            EventRegistrationToken token{};
                            web->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                [](ICoreWebView2*,ICoreWebView2WebMessageReceivedEventArgs* args)->HRESULT {
                                    webReceived(args);return S_OK;
                                }).Get(),&token);
                            web->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>(
                                [](ICoreWebView2*,ICoreWebView2NavigationCompletedEventArgs* args)->HRESULT {
                                    BOOL success=FALSE;
                                    if (!args || FAILED(args->get_IsSuccess(&success)) || !success) {state.store(3);return S_OK;}
                                    webReady=true; state.store(2);
                                    sendToWeb("settings",latestSettings);
                                    sendToWeb("lyrics",latestLyrics);
                                    sendToWeb("timeline",latestFrame);
                                    sendToWeb("locked",locked?"true":"false");
                                    if (visible&&hwnd.load()) ShowWindow(hwnd.load(),SW_SHOWNOACTIVATE);
                                    return S_OK;
                                }).Get(),&token);
                            auto html=desktopHtml();
                            if (html.empty() || FAILED(web->NavigateToString(html.c_str()))) state.store(3);
                            return S_OK;
                        }).Get());
            }).Get());
    if (FAILED(hr)) state.store(3);
}
void forwardMouse(UINT msg, WPARAM wp, LPARAM lp) {
    if (!compositionController || locked) return;
    COREWEBVIEW2_MOUSE_EVENT_KIND kind;
    switch(msg) {
        case WM_MOUSEMOVE:kind=COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE;break;
        case WM_MOUSELEAVE:kind=COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE;break;
        case WM_LBUTTONDOWN:kind=COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN;break;
        case WM_LBUTTONUP:kind=COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP;break;
        default:return;
    }
    POINT pt{GET_X_LPARAM(lp),GET_Y_LPARAM(lp)};
    auto keys = (msg == WM_LBUTTONDOWN || (msg == WM_MOUSEMOVE && (wp & MK_LBUTTON)))
        ? COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON
        : static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(0);
    compositionController->SendMouseInput(kind,keys,0,pt);
    if (msg==WM_MOUSEMOVE) {
        TRACKMOUSEEVENT t{sizeof(t),TME_LEAVE,hwnd.load(),0}; TrackMouseEvent(&t);
    }
}
LRESULT CALLBACK windowProc(HWND h,UINT msg,WPARAM wp,LPARAM lp) {
    switch(msg) {
        case WM_NCHITTEST: {
            if(locked) return HTTRANSPARENT;
            POINT p{GET_X_LPARAM(lp),GET_Y_LPARAM(lp)};ScreenToClient(h,&p);
            // Always HTCLIENT when unlocked; lyrics are draggable via capture,
            // while top-row buttons remain clickable in CompositionController.
            return HTCLIENT;
        }
        case WM_LBUTTONDOWN: {
            if(locked) return 0;
            POINT p{GET_X_LPARAM(lp),GET_Y_LPARAM(lp)};
            // Reserve upper 58px for the toolbar; any lyric text starts dragging.
            if (!(controlsVisible && p.y < 58) && !(settingsPopupOpen && p.y < 110)) {
                lyricPointerDown=true;lyricDidDrag=false;
                GetCursorPos(&dragStartScreen);
                RECT wr{};GetWindowRect(h,&wr);
                dragWindowOrigin={wr.left,wr.top};
                SetCapture(h);
                return 0;
            }
            forwardMouse(msg,wp,lp);return 0;
        }
        case WM_MOUSEMOVE: {
            if(lyricPointerDown) {
                POINT now{};GetCursorPos(&now);
                const int dx=now.x-dragStartScreen.x,dy=now.y-dragStartScreen.y;
                if(!lyricDidDrag && (abs(dx)>4 || abs(dy)>4)) lyricDidDrag=true;
                if(lyricDidDrag) SetWindowPos(h,HWND_TOPMOST,
                    dragWindowOrigin.x+dx,dragWindowOrigin.y+dy,0,0,
                    SWP_NOSIZE|SWP_NOACTIVATE);
                return 0;
            }
            forwardMouse(msg,wp,lp);return 0;
        }
        case WM_LBUTTONUP:
            if(lyricPointerDown) {
                lyricPointerDown=false;
                if(GetCapture()==h) ReleaseCapture();
                // Short click toggles toolbar; drag only moves the window.
                if(!lyricDidDrag) sendToWeb("interaction", "{\"lyricClick\":true}");
                return 0;
            }
            forwardMouse(msg,wp,lp);return 0;
        case WM_CAPTURECHANGED:
            lyricPointerDown=false;return 0;
        case WM_MOUSELEAVE:
            forwardMouse(msg,wp,lp);return 0;
        case WM_SIZE:sizeController();return 0;
        case kFrame: {
            std::unique_ptr<std::string> payload(reinterpret_cast<std::string*>(lp));
            if(payload) {latestFrame=*payload;sendToWeb("timeline",latestFrame);}return 0;
        }
        case kLyrics: {
            std::unique_ptr<std::string> payload(reinterpret_cast<std::string*>(lp));
            if(payload) {latestLyrics=*payload;sendToWeb("lyrics",latestLyrics);}return 0;
        }
        case kSettings: {
            std::unique_ptr<std::string> payload(reinterpret_cast<std::string*>(lp));
            if(payload) {latestSettings=*payload;sendToWeb("settings",latestSettings);}return 0;
        }
        case kVisible:
            visible=wp!=0;
            if(visible&&webReady) ShowWindow(h,SW_SHOWNOACTIVATE);
            else ShowWindow(h,SW_HIDE);
            return 0;
        case kLock:setLock(wp!=0);return 0;
        case kResize: {
            width=std::max(300,std::min(1200,static_cast<int>(wp)));
            SetWindowPos(h,HWND_TOPMOST,0,0,width,height,SWP_NOMOVE|SWP_NOACTIVATE);
            return 0;
        }
        case kShutdown:case WM_CLOSE:
            closeWeb();DestroyWindow(h);return 0;
        case WM_DESTROY:
            hwnd.store(nullptr);PostQuitMessage(0);return 0;
    }
    return DefWindowProcW(h,msg,wp,lp);
}
DWORD WINAPI windowThread(LPVOID) {
    HRESULT hr=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    if (FAILED(hr)){state.store(3);SetEvent(createdEvent);return 1;}
    const wchar_t* klass=L"FloatingCloud_Desktop_Lyrics_040";
    WNDCLASSEXW wc{sizeof(wc)};
    wc.hInstance=module;wc.lpfnWndProc=windowProc;wc.lpszClassName=klass;
    wc.hCursor=LoadCursor(nullptr,IDC_ARROW);
    RegisterClassExW(&wc);
    int screenW=GetSystemMetrics(SM_CXSCREEN), screenH=GetSystemMetrics(SM_CYSCREEN);
    HWND h=CreateWindowExW(WS_EX_NOREDIRECTIONBITMAP|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW|WS_EX_TOPMOST,
        klass,L"FloatingCloud Desktop Lyrics",WS_POPUP,
        (screenW-width)/2,screenH*3/4,width,height,nullptr,nullptr,module,nullptr);
    if(!h){state.store(3);SetEvent(createdEvent);CoUninitialize();return 1;}
    hwnd.store(h);SetEvent(createdEvent);
    initWebView();
    MSG m{};
    while(GetMessageW(&m,nullptr,0,0)>0){TranslateMessage(&m);DispatchMessageW(&m);}
    closeWeb();
    compositionDevice.Reset();
    CoUninitialize();
    state.store(0);
    return 0;
}

bool startHost() {
    std::lock_guard<std::mutex> guard(gate);
    if (worker && WaitForSingleObject(worker,0)==WAIT_OBJECT_0) {
        CloseHandle(worker); worker=nullptr;
        if(createdEvent){CloseHandle(createdEvent);createdEvent=nullptr;}
    }
    if (worker) return hwnd.load()!=nullptr || state.load()==1 || state.load()==2;
    state.store(1);
    createdEvent=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(!createdEvent) {state.store(3);return false;}
    worker=CreateThread(nullptr,0,windowThread,nullptr,0,nullptr);
    if(!worker){CloseHandle(createdEvent);createdEvent=nullptr;state.store(3);return false;}
    DWORD result=WaitForSingleObject(createdEvent,4000);
    if(result!=WAIT_OBJECT_0 || !hwnd.load()) {state.store(3);return false;}
    return true;
}
void stopHost() {
    std::lock_guard<std::mutex> guard(gate);
    if(!worker) return;
    HWND h=hwnd.load();
    if(h) PostMessageW(h,kShutdown,0,0);
    DWORD result=WaitForSingleObject(worker,4000);
    if(result==WAIT_OBJECT_0){CloseHandle(worker);worker=nullptr;}
    if(createdEvent && result==WAIT_OBJECT_0){CloseHandle(createdEvent);createdEvent=nullptr;}
}
bool postValue(UINT type,const char* raw) {
    HWND h=hwnd.load();
    if(!h||!raw) return false;
    size_t n=strnlen_s(raw,131073);
    if(n==0||n>131072) return false;
    auto payload=std::make_unique<std::string>(raw,n);
    if(!PostMessageW(h,type,0,reinterpret_cast<LPARAM>(payload.get()))) return false;
    payload.release();return true;
}
} // namespace fc

enum class NativeAPIType {Int,Boolean,Double,String,V8Value};
enum class NCMProcessType {Undetected=0,Main=1,Renderer=0x10,GPU=0x100,Utility=0x1000};
struct PluginAPI {
    int (*addNativeAPI)(NativeAPIType args[],int argsNum,const char* identifier,const char* (*function)(void**));
    const char* betterncmVersion;
    NCMProcessType processType;
    const unsigned short (*ncmVersion)[3];
};
static const char* ping(void**) {return "native-loaded";}
static const char* open(void**) {return fc::startHost()?"started":"start-failed";}
static const char* status(void**) {
    switch(fc::state.load()){
        case 0:return "idle";
        case 1:return "starting";
        case 2:return "ready";
        default:return "error";
    }
}
static const char* close(void**) {HWND h=fc::hwnd.load();return (h&&PostMessageW(h,fc::kVisible,FALSE,0))?"ok":"unavailable";}
static const char* show(void**) {HWND h=fc::hwnd.load();return (h&&PostMessageW(h,fc::kVisible,TRUE,0))?"ok":"unavailable";}
static const char* setSettings(void** a){return a&&fc::postValue(fc::kSettings,static_cast<char*>(a[0]))?"ok":"error";}
static const char* setLyrics(void** a){return a&&fc::postValue(fc::kLyrics,static_cast<char*>(a[0]))?"ok":"error";}
static const char* setFrame(void** a){return a&&fc::postValue(fc::kFrame,static_cast<char*>(a[0]))?"ok":"error";}
static const char* setLock(void** a){
    HWND h=fc::hwnd.load();
    return h && a && a[0] && PostMessageW(h,fc::kLock,std::strcmp(static_cast<char*>(a[0]),"true")==0,0)?"ok":"unavailable";
}
static const char* setWidth(void** a){
    HWND h=fc::hwnd.load();
    return h&&a&&a[0]&&PostMessageW(h,fc::kResize,static_cast<WPARAM>(std::atoi(static_cast<char*>(a[0]))),0)?"ok":"unavailable";
}
static const char* poll(void**){
    switch(fc::requestedAction.exchange(0)){
        case 1:return "previous";case 2:return "toggle";case 3:return "next";
        case 4:return "close";case 5:return "lock";
        case 6:return "seekBack";case 7:return "seekForward";
        case 8:return "fontSmaller";case 9:return "fontLarger";default:return "";
    }
}
static const char* shutdown(void**){fc::stopHost();return "ok";}
BOOL WINAPI DllMain(HINSTANCE h,DWORD reason,LPVOID){
    if(reason==DLL_PROCESS_ATTACH){fc::module=h;DisableThreadLibraryCalls(h);}return TRUE;
}
extern "C" __declspec(dllexport) int BetterNCMPluginMain(const PluginAPI* api){
    if(!api||api->processType!=NCMProcessType::Renderer||!api->addNativeAPI)return 0;
    static NativeAPIType stringArg[]={NativeAPIType::String};
    api->addNativeAPI(nullptr,0,"floatingcloud.ping",ping);
    api->addNativeAPI(nullptr,0,"floatingcloud.open",open);
    api->addNativeAPI(nullptr,0,"floatingcloud.status",status);
    api->addNativeAPI(nullptr,0,"floatingcloud.show",show);
    api->addNativeAPI(nullptr,0,"floatingcloud.close",close);
    api->addNativeAPI(stringArg,1,"floatingcloud.settings",setSettings);
    api->addNativeAPI(stringArg,1,"floatingcloud.lyrics",setLyrics);
    api->addNativeAPI(stringArg,1,"floatingcloud.timeline",setFrame);
    api->addNativeAPI(stringArg,1,"floatingcloud.lock",setLock);
    api->addNativeAPI(stringArg,1,"floatingcloud.width",setWidth);
    api->addNativeAPI(nullptr,0,"floatingcloud.poll",poll);
    api->addNativeAPI(nullptr,0,"floatingcloud.shutdown",shutdown);
    return 0;
}

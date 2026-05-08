//+------------------------------------------------------------------+
//|  SimpleTrader Live EA — MetaTrader 5                            |
//|  Versión: 2.0.0                                                  |
//|  Conecta tu cuenta MT5 a https://simpletrader.app en tiempo real |
//+------------------------------------------------------------------+
//
//  INSTRUCCIONES DE INSTALACIÓN:
//  1. Copia este archivo a: <MT5_DATA_FOLDER>/MQL5/Experts/
//  2. En MetaTrader 5: Herramientas → Opciones → Asesores Expertos
//     → Activar "Permitir solicitudes WebRequest"
//     → Añadir URL: https://simpletrader.app
//  3. Reinicia MetaTrader 5
//  4. Abre un gráfico cualquiera (ej: EURUSD M1)
//  5. Arrastra el EA al gráfico, pega tu Token de conexión
//  6. Activa "Permitir trading en vivo" en la configuración del EA
//  7. Haz clic en OK
//
//  Comandos soportados desde SimpleTrader:
//    close_all      — Cierra todas las posiciones abiertas
//    close_ticket   — Cierra una posición por ticket
//    close_profit   — Cierra todas las posiciones en beneficio
//    close_loss     — Cierra todas las posiciones en pérdida
//    open_order     — Abre una nueva posición
//    modify_sl_tp   — Modifica SL/TP de una posición
//
//+------------------------------------------------------------------+

#property copyright   "SimpleTrader App"
#property link        "https://simpletrader.app"
#property version     "2.00"
#property description "Conecta tu cuenta MT5 a SimpleTrader en tiempo real."
#property description "Genera tu token en simpletrader.app → Cuentas Live."

//--- Parámetros de entrada
input string InpToken     = "";     // 🔑 Token de conexión (obtén en simpletrader.app)
input int    InpInterval  = 5;      // ⏱ Intervalo de actualización (segundos, mín. 3)
input double InpMaxVolume = 10.0;   // 🛡 Volumen máximo por orden remota (seguridad)
input bool   InpDebug     = false;  // 🐛 Mostrar logs detallados

//--- API endpoint
static const string API_URL = "https://simpletrader.app/api/mt5/tick";

//--- Magic number for SimpleTrader orders
#define ST_MAGIC 20250001

//+------------------------------------------------------------------+
int OnInit() {
  string _tok = InpToken;
  StringTrimLeft(_tok);
  StringTrimRight(_tok);
  if (StringLen(_tok) < 20) {
    MessageBox(
      "Token inválido o vacío.\n\n"
      "Por favor:\n"
      "1. Ve a simpletrader.app → Cuentas Live\n"
      "2. Haz clic en 'Nueva conexión'\n"
      "3. Copia el token generado y pégalo en los parámetros del EA",
      "SimpleTrader EA — Error de configuración",
      MB_ICONERROR
    );
    return INIT_PARAMETERS_INCORRECT;
  }

  int interval = MathMax(3, InpInterval);
  EventSetTimer(interval);
  OnTimer();

  Print("✅ SimpleTrader MT5 EA v2.0 iniciado | Token: ", StringSubstr(InpToken, 0, 8), "...",
        " | Broker: ", AccountInfoString(ACCOUNT_COMPANY));
  Comment("SimpleTrader: CONECTANDO...");
  return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
  EventKillTimer();
  Comment("");
  Print("SimpleTrader EA detenido. Razón: ", reason);
}

void OnTimer() { SendHeartbeat(); }

//+------------------------------------------------------------------+
void SendHeartbeat() {
  string accountJson   = BuildAccountJSON();
  string positionsJson = BuildPositionsJSON();

  string body = "{";
  body += "\"token\":\"" + InpToken + "\",";
  body += "\"platform\":\"MT5\",";
  body += "\"account\":"   + accountJson + ",";
  body += "\"positions\":" + positionsJson + ",";
  body += "\"timestamp\":" + IntegerToString((long)TimeCurrent());
  body += "}";

  char   post[];
  char   result[];
  string responseHeaders;
  StringToCharArray(body, post, 0, StringLen(body), CP_UTF8);

  ResetLastError();
  int httpCode = WebRequest(
    "POST", API_URL,
    "Content-Type: application/json\r\n",
    5000, post, result, responseHeaders
  );

  if (httpCode == 200) {
    string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
    Comment("SimpleTrader: 🟢 ONLINE | " + AccountInfoString(ACCOUNT_COMPANY) +
            " | Balance: " + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) +
            " " + AccountInfoString(ACCOUNT_CURRENCY) +
            " | Pos: " + IntegerToString(PositionsTotal()));
    if (InpDebug) Print("Response: ", response);

    // Process pending command
    if (StringFind(response, "\"command\"") >= 0 &&
        StringFind(response, "\"command\":null") < 0 &&
        StringFind(response, "\"command\":\"\"")  < 0) {
      ProcessCommand(response);
    }
  }
  else if (httpCode == -1) {
    int lastErr = GetLastError();
    Comment("SimpleTrader: ⚠ Error de red (", lastErr, ")");
    if (lastErr == 5203 || lastErr == 4014) {
      Print("❌ SimpleTrader: URL no permitida. Ve a Herramientas → Opciones → Asesores Expertos",
            " y añade https://simpletrader.app a la lista de URLs permitidas.");
    }
  }
  else if (httpCode == 401) {
    Comment("SimpleTrader: ❌ Token inválido");
    Print("SimpleTrader: Token rechazado (401). Genera uno nuevo en simpletrader.app");
  }
  else {
    Comment("SimpleTrader: ⚠ HTTP " + IntegerToString(httpCode));
    if (InpDebug) Print("HTTP ", httpCode, " | ", CharArrayToString(result));
  }
}

//+------------------------------------------------------------------+
string BuildAccountJSON() {
  double ml = (AccountInfoDouble(ACCOUNT_MARGIN) > 0)
              ? AccountInfoDouble(ACCOUNT_MARGIN_LEVEL)
              : 0;
  return "{" +
    "\"number\":\""    + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))    + "\"," +
    "\"broker\":\""    + EscapeJson(AccountInfoString(ACCOUNT_COMPANY))        + "\"," +
    "\"server\":\""    + EscapeJson(AccountInfoString(ACCOUNT_SERVER))         + "\"," +
    "\"currency\":\""  + AccountInfoString(ACCOUNT_CURRENCY)                    + "\"," +
    "\"leverage\":"    + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE))  + "," +
    "\"balance\":"     + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2)  + "," +
    "\"equity\":"      + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2)   + "," +
    "\"margin\":"      + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2)   + "," +
    "\"free_margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + "," +
    "\"margin_level\":" + DoubleToString(ml, 2)                                 + "," +
    "\"profit\":"      + DoubleToString(AccountInfoDouble(ACCOUNT_PROFIT), 2)  +
  "}";
}

//+------------------------------------------------------------------+
string BuildPositionsJSON() {
  string j = "[";
  int total = PositionsTotal();
  for (int i = 0; i < total; i++) {
    ulong ticket = PositionGetTicket(i);
    if (!PositionSelectByTicket(ticket)) continue;
    if (i > 0) j += ",";
    j += "{" +
      "\"ticket\":"        + IntegerToString(ticket)                                              + "," +
      "\"symbol\":\""      + PositionGetString(POSITION_SYMBOL)                                   + "\"," +
      "\"type\":\""        + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL") + "\"," +
      "\"volume\":"        + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2)                + "," +
      "\"open_price\":"    + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 5)            + "," +
      "\"current_price\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_CURRENT), 5)        + "," +
      "\"sl\":"            + DoubleToString(PositionGetDouble(POSITION_SL), 5)                    + "," +
      "\"tp\":"            + DoubleToString(PositionGetDouble(POSITION_TP), 5)                    + "," +
      "\"profit\":"        + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2)                + "," +
      "\"swap\":"          + DoubleToString(PositionGetDouble(POSITION_SWAP), 2)                  + "," +
      "\"open_time\":"     + IntegerToString((long)PositionGetInteger(POSITION_TIME))             + "," +
      "\"magic\":"         + IntegerToString(PositionGetInteger(POSITION_MAGIC))                  +
    "}";
  }
  return j + "]";
}

//+------------------------------------------------------------------+
string EscapeJson(string s) {
  StringReplace(s, "\\", "\\\\");
  StringReplace(s, "\"", "\\\"");
  return s;
}

//+------------------------------------------------------------------+
// Simple JSON value extractor: find "key":VALUE or "key":"VALUE"
string JsonGetString(string json, string key) {
  string search = "\"" + key + "\":\"";
  int pos = StringFind(json, search);
  if (pos < 0) return "";
  int start = pos + StringLen(search);
  int end   = StringFind(json, "\"", start);
  if (end < 0) return "";
  return StringSubstr(json, start, end - start);
}

double JsonGetDouble(string json, string key) {
  string search = "\"" + key + "\":";
  int pos = StringFind(json, search);
  if (pos < 0) return 0;
  int start = pos + StringLen(search);
  // Read until comma, } or ]
  string val = "";
  for (int i = start; i < StringLen(json) && i < start + 30; i++) {
    ushort ch = StringGetCharacter(json, i);
    if (ch == ',' || ch == '}' || ch == ']' || ch == ' ') break;
    val += ShortToString(ch);
  }
  return StringToDouble(val);
}

long JsonGetLong(string json, string key) {
  return (long)JsonGetDouble(json, key);
}

//+------------------------------------------------------------------+
void ProcessCommand(string response) {
  // Extract command object from response
  int cmdPos = StringFind(response, "\"command\":");
  if (cmdPos < 0) return;

  string cmdPart = StringSubstr(response, cmdPos + 10);
  Print("SimpleTrader: Procesando comando → ", StringSubstr(cmdPart, 0, 80));

  // ── close_all ──────────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "close_all") >= 0) {
    int total = PositionsTotal();
    int closed = 0;
    for (int i = total - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if (!PositionSelectByTicket(ticket)) continue;
      if (ClosePosition(ticket)) closed++;
    }
    Print("SimpleTrader ✅ close_all: ", closed, " posiciones cerradas.");
    return;
  }

  // ── close_profit ───────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "close_profit") >= 0) {
    int total = PositionsTotal();
    int closed = 0;
    for (int i = total - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if (!PositionSelectByTicket(ticket)) continue;
      if (PositionGetDouble(POSITION_PROFIT) > 0) {
        if (ClosePosition(ticket)) closed++;
      }
    }
    Print("SimpleTrader ✅ close_profit: ", closed, " posiciones en beneficio cerradas.");
    return;
  }

  // ── close_loss ─────────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "close_loss") >= 0) {
    int total = PositionsTotal();
    int closed = 0;
    for (int i = total - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if (!PositionSelectByTicket(ticket)) continue;
      if (PositionGetDouble(POSITION_PROFIT) < 0) {
        if (ClosePosition(ticket)) closed++;
      }
    }
    Print("SimpleTrader ✅ close_loss: ", closed, " posiciones en pérdida cerradas.");
    return;
  }

  // ── close_ticket ───────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "close_ticket") >= 0) {
    long ticket = JsonGetLong(cmdPart, "ticket");
    if (ticket > 0 && PositionSelectByTicket((ulong)ticket)) {
      if (ClosePosition((ulong)ticket))
        Print("SimpleTrader ✅ close_ticket: ticket ", ticket, " cerrado.");
      else
        Print("SimpleTrader ❌ close_ticket: error cerrando ticket ", ticket);
    }
    return;
  }

  // ── modify_sl_tp ───────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "modify_sl_tp") >= 0) {
    long   ticket = JsonGetLong(cmdPart, "ticket");
    double sl     = JsonGetDouble(cmdPart, "sl");
    double tp     = JsonGetDouble(cmdPart, "tp");

    if (ticket > 0 && PositionSelectByTicket((ulong)ticket)) {
      MqlTradeRequest req = {};
      MqlTradeResult  res = {};
      req.action   = TRADE_ACTION_SLTP;
      req.position = (ulong)ticket;
      req.symbol   = PositionGetString(POSITION_SYMBOL);
      req.sl       = sl;
      req.tp       = tp;
      if (OrderSend(req, res))
        Print("SimpleTrader ✅ modify_sl_tp: ticket ", ticket, " SL=", sl, " TP=", tp);
      else
        Print("SimpleTrader ❌ modify_sl_tp: retcode=", res.retcode, " msg=", res.comment);
    }
    return;
  }

  // ── open_order ─────────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "open_order") >= 0) {
    string symbol     = JsonGetString(cmdPart, "symbol");
    string order_type = JsonGetString(cmdPart, "order_type");
    double volume     = JsonGetDouble(cmdPart, "volume");
    double sl         = JsonGetDouble(cmdPart, "sl");
    double tp         = JsonGetDouble(cmdPart, "tp");
    string comment    = JsonGetString(cmdPart, "comment");

    // Safety checks
    if (StringLen(symbol) < 3) { Print("SimpleTrader: open_order — símbolo inválido"); return; }
    if (volume <= 0 || volume > InpMaxVolume) {
      Print("SimpleTrader: open_order — volumen inválido o excede límite (", InpMaxVolume, "): ", volume);
      return;
    }

    ENUM_ORDER_TYPE orderType = (order_type == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
    double price = (orderType == ORDER_TYPE_BUY)
                   ? SymbolInfoDouble(symbol, SYMBOL_ASK)
                   : SymbolInfoDouble(symbol, SYMBOL_BID);

    MqlTradeRequest req = {};
    MqlTradeResult  res = {};
    req.action    = TRADE_ACTION_DEAL;
    req.symbol    = symbol;
    req.type      = orderType;
    req.volume    = volume;
    req.price     = price;
    req.sl        = sl;
    req.tp        = tp;
    req.magic     = ST_MAGIC;
    req.comment   = StringLen(comment) > 0 ? comment : "SimpleTrader";
    req.deviation = 20;
    req.type_filling = ORDER_FILLING_IOC;

    if (OrderSend(req, res))
      Print("SimpleTrader ✅ open_order: ", order_type, " ", volume, " ", symbol, " ticket=", res.order);
    else
      Print("SimpleTrader ❌ open_order: retcode=", res.retcode, " msg=", res.comment);
    return;
  }
}

//+------------------------------------------------------------------+
// Helper to close a position by ticket
bool ClosePosition(ulong ticket) {
  if (!PositionSelectByTicket(ticket)) return false;

  MqlTradeRequest req = {};
  MqlTradeResult  res = {};
  req.action   = TRADE_ACTION_DEAL;
  req.position = ticket;
  req.symbol   = PositionGetString(POSITION_SYMBOL);
  req.volume   = PositionGetDouble(POSITION_VOLUME);
  req.type     = (ENUM_ORDER_TYPE)(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY
                 ? ORDER_TYPE_SELL : ORDER_TYPE_BUY);
  req.price    = (req.type == ORDER_TYPE_BUY)
                 ? SymbolInfoDouble(req.symbol, SYMBOL_ASK)
                 : SymbolInfoDouble(req.symbol, SYMBOL_BID);
  req.deviation = 20;
  req.comment  = "SimpleTrader:Close";

  if (OrderSend(req, res)) return true;
  Print("SimpleTrader: Error cerrando ticket ", ticket, " retcode=", res.retcode);
  return false;
}

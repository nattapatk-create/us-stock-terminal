// รายชื่อ S&P 500 ทั้งหมด (503 symbols) จัดกลุ่มตาม GICS Sector — ใช้สำหรับหน้า
// S&P 500 Heatmap โดยเฉพาะ ข้อมูลชื่อบริษัท/หมวดหมู่อ้างอิงจาก Wikipedia (แก้ไขล่าสุด)
// ไม่ได้ดึงจาก API เพราะรายชื่อสมาชิกดัชนีเปลี่ยนไม่บ่อย (ไม่กี่ครั้ง/ปี) การฝังไว้
// ในโค้ดจึงประหยัดโควตา API ได้มากกว่าการยิงขอรายชื่อทุกครั้งที่เปิดหน้านี้
export const SP500_SECTOR_TH = {
  "Information Technology": "เทคโนโลยีสารสนเทศ",
  "Financials": "การเงิน",
  "Health Care": "สาธารณสุข",
  "Consumer Discretionary": "สินค้าฟุ่มเฟือย",
  "Communication Services": "สื่อสาร",
  "Industrials": "อุตสาหกรรม",
  "Consumer Staples": "สินค้าจำเป็น",
  "Energy": "พลังงาน",
  "Utilities": "สาธารณูปโภค",
  "Real Estate": "อสังหาริมทรัพย์",
  "Materials": "วัสดุ",
};
export const SP500_UNIVERSE = {
  "Information Technology": [
    ["ACN","Accenture"], ["ADBE","Adobe Inc."], ["AMD","Advanced Micro Devices"], ["AKAM","Akamai Technologies"], ["APH","Amphenol"], ["ADI","Analog Devices"],
    ["AAPL","Apple Inc."], ["AMAT","Applied Materials"], ["APP","AppLovin"], ["ANET","Arista Networks"], ["ADSK","Autodesk"], ["AVGO","Broadcom"],
    ["CDNS","Cadence Design Systems"], ["CDW","CDW Corporation"], ["CIEN","Ciena"], ["CSCO","Cisco"], ["CTSH","Cognizant"], ["COHR","Coherent Corp."],
    ["GLW","Corning Inc."], ["CRWD","CrowdStrike"], ["DDOG","Datadog"], ["DELL","Dell Technologies"], ["FFIV","F5, Inc."], ["FICO","Fair Isaac"],
    ["FSLR","First Solar"], ["FLEX","Flex Ltd."], ["FTNT","Fortinet"], ["IT","Gartner"], ["GEN","Gen Digital"], ["GDDY","GoDaddy"],
    ["HPE","Hewlett Packard Enterprise"], ["HPQ","HP Inc."], ["IBM","IBM"], ["INTC","Intel"], ["INTU","Intuit"], ["JBL","Jabil"],
    ["KEYS","Keysight Technologies"], ["KLAC","KLA Corporation"], ["LRCX","Lam Research"], ["LITE","Lumentum"], ["MRVL","Marvell Technology"], ["MCHP","Microchip Technology"],
    ["MU","Micron Technology"], ["MSFT","Microsoft"], ["MPWR","Monolithic Power Systems"], ["MSI","Motorola Solutions"], ["NTAP","NetApp"], ["NVDA","Nvidia"],
    ["NXPI","NXP Semiconductors"], ["ON","ON Semiconductor"], ["ORCL","Oracle Corporation"], ["PLTR","Palantir Technologies"], ["PANW","Palo Alto Networks"], ["PTC","PTC Inc."],
    ["QCOM","Qualcomm"], ["Q","Qnity Electronics"], ["ROP","Roper Technologies"], ["CRM","Salesforce"], ["SNDK","Sandisk"], ["STX","Seagate Technology"],
    ["NOW","ServiceNow"], ["SWKS","Skyworks Solutions"], ["SMCI","Supermicro"], ["SNPS","Synopsys"], ["TEL","TE Connectivity"], ["TDY","Teledyne Technologies"],
    ["TER","Teradyne"], ["TXN","Texas Instruments"], ["TRMB","Trimble Inc."], ["TYL","Tyler Technologies"], ["VRSN","Verisign"], ["WDC","Western Digital"],
    ["WDAY","Workday, Inc."], ["ZBRA","Zebra Technologies"],
  ],
  "Financials": [
    ["AFL","Aflac"], ["ALL","Allstate"], ["AXP","American Express"], ["AIG","American International Group"], ["AMP","Ameriprise Financial"], ["AON","Aon plc"],
    ["APO","Apollo Global Management"], ["ACGL","Arch Capital Group"], ["ARES","Ares Management"], ["AJG","Arthur J. Gallagher & Co."], ["AIZ","Assurant"], ["BAC","Bank of America"],
    ["BRK.B","Berkshire Hathaway"], ["BLK","BlackRock"], ["BX","Blackstone Inc."], ["XYZ","Block, Inc."], ["BNY","BNY Mellon"], ["BRO","Brown & Brown"],
    ["COF","Capital One"], ["CBOE","Cboe Global Markets"], ["SCHW","Charles Schwab Corporation"], ["CB","Chubb Limited"], ["CINF","Cincinnati Financial"], ["C","Citigroup"],
    ["CFG","Citizens Financial Group"], ["CME","CME Group"], ["COIN","Coinbase"], ["CPAY","Corpay"], ["ERIE","Erie Indemnity"], ["EG","Everest Group"],
    ["FDS","FactSet"], ["FIS","Fidelity National Information Services"], ["FITB","Fifth Third Bancorp"], ["FISV","Fiserv"], ["BEN","Franklin Resources"], ["GPN","Global Payments"],
    ["GL","Globe Life"], ["GS","Goldman Sachs"], ["HIG","Hartford (The)"], ["HBAN","Huntington Bancshares"], ["IBKR","Interactive Brokers"], ["ICE","Intercontinental Exchange"],
    ["IVZ","Invesco"], ["JKHY","Jack Henry & Associates"], ["JPM","JPMorgan Chase"], ["KEY","KeyCorp"], ["KKR","KKR & Co."], ["L","Loews Corporation"],
    ["MTB","M&T Bank"], ["MMC","Marsh McLennan"], ["MA","Mastercard"], ["MET","MetLife"], ["MCO","Moody's Corporation"], ["MS","Morgan Stanley"],
    ["MSCI","MSCI Inc."], ["NDAQ","Nasdaq, Inc."], ["NTRS","Northern Trust"], ["PYPL","PayPal"], ["PNC","PNC Financial Services"], ["PFG","Principal Financial Group"],
    ["PGR","Progressive Corporation"], ["PRU","Prudential Financial"], ["RJF","Raymond James Financial"], ["RF","Regions Financial Corporation"], ["HOOD","Robinhood Markets"], ["SPGI","S&P Global"],
    ["STT","State Street Corporation"], ["SYF","Synchrony Financial"], ["TROW","T. Rowe Price"], ["TRV","Travelers Companies (The)"], ["TFC","Truist Financial"], ["USB","U.S. Bancorp"],
    ["V","Visa Inc."], ["WRB","W. R. Berkley Corporation"], ["WFC","Wells Fargo"], ["WTW","Willis Towers Watson"],
  ],
  "Health Care": [
    ["ABT","Abbott Laboratories"], ["ABBV","AbbVie"], ["A","Agilent Technologies"], ["ALGN","Align Technology"], ["AMGN","Amgen"], ["BAX","Baxter International"],
    ["BDX","Becton Dickinson"], ["TECH","Bio-Techne"], ["BIIB","Biogen"], ["BSX","Boston Scientific"], ["BMY","Bristol Myers Squibb"], ["CAH","Cardinal Health"],
    ["COR","Cencora"], ["CNC","Centene Corporation"], ["CRL","Charles River Laboratories"], ["CI","Cigna"], ["COO","Cooper Companies (The)"], ["CVS","CVS Health"],
    ["DHR","Danaher Corporation"], ["DVA","DaVita"], ["DXCM","Dexcom"], ["EW","Edwards Lifesciences"], ["ELV","Elevance Health"], ["GEHC","GE HealthCare"],
    ["GILD","Gilead Sciences"], ["HCA","HCA Healthcare"], ["HSIC","Henry Schein"], ["HUM","Humana"], ["IDXX","Idexx Laboratories"], ["INCY","Incyte"],
    ["PODD","Insulet Corporation"], ["ISRG","Intuitive Surgical"], ["IQV","IQVIA"], ["JNJ","Johnson & Johnson"], ["LH","Labcorp"], ["LLY","Lilly (Eli)"],
    ["MCK","McKesson Corporation"], ["MDT","Medtronic"], ["MRK","Merck & Co."], ["MTD","Mettler Toledo"], ["MRNA","Moderna"], ["PFE","Pfizer"],
    ["DGX","Quest Diagnostics"], ["REGN","Regeneron Pharmaceuticals"], ["RMD","ResMed"], ["RVTY","Revvity"], ["SOLV","Solventum"], ["STE","Steris"],
    ["SYK","Stryker Corporation"], ["TMO","Thermo Fisher Scientific"], ["UNH","UnitedHealth Group"], ["UHS","Universal Health Services"], ["VEEV","Veeva Systems"], ["VRTX","Vertex Pharmaceuticals"],
    ["VTRS","Viatris"], ["WAT","Waters Corporation"], ["WST","West Pharmaceutical Services"], ["ZBH","Zimmer Biomet"], ["ZTS","Zoetis"],
  ],
  "Consumer Discretionary": [
    ["ABNB","Airbnb"], ["AMZN","Amazon"], ["APTV","Aptiv"], ["AZO","AutoZone"], ["BBY","Best Buy"], ["BKNG","Booking Holdings"],
    ["CCL","Carnival Corporation"], ["CVNA","Carvana"], ["CMG","Chipotle Mexican Grill"], ["DRI","Darden Restaurants"], ["DECK","Deckers Brands"], ["DPZ","Domino's"],
    ["DASH","DoorDash"], ["DHI","D. R. Horton"], ["EBAY","eBay Inc."], ["EXPE","Expedia Group"], ["F","Ford Motor Company"], ["GRMN","Garmin"],
    ["GM","General Motors"], ["GPC","Genuine Parts Company"], ["HAS","Hasbro"], ["HLT","Hilton Worldwide"], ["HD","Home Depot (The)"], ["LVS","Las Vegas Sands"],
    ["LEN","Lennar"], ["LOW","Lowe's"], ["LULU","Lululemon Athletica"], ["MAR","Marriott International"], ["MCD","McDonald's"], ["MGM","MGM Resorts"],
    ["NKE","Nike, Inc."], ["NCLH","Norwegian Cruise Line Holdings"], ["NVR","NVR, Inc."], ["ORLY","O'Reilly Automotive"], ["PHM","PulteGroup"], ["RL","Ralph Lauren Corporation"],
    ["ROST","Ross Stores"], ["RCL","Royal Caribbean Group"], ["SBUX","Starbucks"], ["TPR","Tapestry, Inc."], ["TSLA","Tesla, Inc."], ["TJX","TJX Companies"],
    ["TSCO","Tractor Supply"], ["ULTA","Ulta Beauty"], ["WSM","Williams-Sonoma, Inc."], ["WYNN","Wynn Resorts"], ["YUM","Yum! Brands"],
  ],
  "Communication Services": [
    ["GOOGL","Alphabet Inc. (Class A)"], ["GOOG","Alphabet Inc. (Class C)"], ["T","AT&T"], ["CHTR","Charter Communications"], ["CMCSA","Comcast"], ["ECHO","EchoStar"],
    ["EA","Electronic Arts"], ["FOXA","Fox Corporation (Class A)"], ["FOX","Fox Corporation (Class B)"], ["LYV","Live Nation Entertainment"], ["META","Meta Platforms"], ["NFLX","Netflix"],
    ["NWSA","News Corp (Class A)"], ["NWS","News Corp (Class B)"], ["OMC","Omnicom Group"], ["PSKY","Paramount Skydance Corporation"], ["TMUS","T-Mobile US"], ["TTWO","Take-Two Interactive"],
    ["TKO","TKO Group Holdings"], ["TTD","Trade Desk (The)"], ["VZ","Verizon"], ["DIS","Walt Disney Company (The)"], ["WBD","Warner Bros. Discovery"],
  ],
  "Industrials": [
    ["MMM","3M"], ["AOS","A. O. Smith"], ["ALLE","Allegion"], ["AME","Ametek"], ["ADP","Automatic Data Processing"], ["AXON","Axon Enterprise"],
    ["BA","Boeing"], ["BR","Broadridge Financial Solutions"], ["BLDR","Builders FirstSource"], ["CHRW","C.H. Robinson"], ["CARR","Carrier Global"], ["CAT","Caterpillar Inc."],
    ["CTAS","Cintas"], ["FIX","Comfort Systems USA"], ["CPRT","Copart"], ["CSX","CSX Corporation"], ["CMI","Cummins"], ["DE","Deere & Company"],
    ["DAL","Delta Air Lines"], ["DOV","Dover Corporation"], ["ETN","Eaton Corporation"], ["EME","Emcor"], ["EMR","Emerson Electric"], ["EFX","Equifax"],
    ["EXPD","Expeditors International"], ["FAST","Fastenal"], ["FDX","FedEx"], ["FDXF","FedEx Freight"], ["FTV","Fortive"], ["GE","GE Aerospace"],
    ["GEV","GE Vernova"], ["GNRC","Generac"], ["GD","General Dynamics"], ["HONA","Honeywell Aerospace"], ["HON","Honeywell Technologies"], ["HWM","Howmet Aerospace"],
    ["HUBB","Hubbell Incorporated"], ["HII","Huntington Ingalls Industries"], ["IEX","IDEX Corporation"], ["ITW","Illinois Tool Works"], ["IR","Ingersoll Rand"], ["JBHT","J.B. Hunt"],
    ["J","Jacobs Solutions"], ["JCI","Johnson Controls"], ["LHX","L3Harris"], ["LDOS","Leidos"], ["LII","Lennox International"], ["LMT","Lockheed Martin"],
    ["MAS","Masco"], ["NDSN","Nordson Corporation"], ["NSC","Norfolk Southern"], ["NOC","Northrop Grumman"], ["ODFL","Old Dominion"], ["OTIS","Otis Worldwide"],
    ["PCAR","Paccar"], ["PH","Parker Hannifin"], ["PAYX","Paychex"], ["PNR","Pentair"], ["PWR","Quanta Services"], ["RTX","RTX Corporation"],
    ["RSG","Republic Services"], ["ROK","Rockwell Automation"], ["ROL","Rollins, Inc."], ["SNA","Snap-on"], ["LUV","Southwest Airlines"], ["SWK","Stanley Black & Decker"],
    ["TXT","Textron"], ["TT","Trane Technologies"], ["TDG","TransDigm Group"], ["UBER","Uber"], ["UNP","Union Pacific Corporation"], ["UAL","United Airlines Holdings"],
    ["UPS","United Parcel Service"], ["URI","United Rentals"], ["VLTO","Veralto"], ["VRSK","Verisk Analytics"], ["VRT","Vertiv"], ["GWW","W. W. Grainger"],
    ["WAB","Wabtec"], ["WM","Waste Management"], ["XYL","Xylem Inc."],
  ],
  "Consumer Staples": [
    ["MO","Altria"], ["ADM","Archer Daniels Midland"], ["BF.B","Brown–Forman"], ["BG","Bunge Global"], ["CASY","Casey's"], ["CHD","Church & Dwight"],
    ["CLX","Clorox"], ["KO","Coca-Cola Company (The)"], ["CL","Colgate-Palmolive"], ["STZ","Constellation Brands"], ["COST","Costco"], ["DG","Dollar General"],
    ["DLTR","Dollar Tree"], ["EL","Estée Lauder Companies (The)"], ["GIS","General Mills"], ["HSY","Hershey Company (The)"], ["HRL","Hormel Foods"], ["KVUE","Kenvue"],
    ["KDP","Keurig Dr Pepper"], ["KMB","Kimberly-Clark"], ["KHC","Kraft Heinz"], ["KR","Kroger"], ["MKC","McCormick & Company"], ["TAP","Molson Coors Beverage Company"],
    ["MDLZ","Mondelez International"], ["MNST","Monster Beverage"], ["PEP","PepsiCo"], ["PM","Philip Morris International"], ["PG","Procter & Gamble"], ["SJM","J.M. Smucker Company (The)"],
    ["SYY","Sysco"], ["TGT","Target Corporation"], ["TSN","Tyson Foods"], ["WMT","Walmart"],
  ],
  "Energy": [
    ["APA","APA Corporation"], ["BKR","Baker Hughes"], ["CVX","Chevron Corporation"], ["COP","ConocoPhillips"], ["DVN","Devon Energy"], ["FANG","Diamondback Energy"],
    ["EOG","EOG Resources"], ["EQT","EQT Corporation"], ["EXE","Expand Energy"], ["XOM","ExxonMobil"], ["HAL","Halliburton"], ["KMI","Kinder Morgan"],
    ["MPC","Marathon Petroleum"], ["OXY","Occidental Petroleum"], ["OKE","Oneok"], ["PSX","Phillips 66"], ["SLB","Schlumberger"], ["TRGP","Targa Resources"],
    ["TPL","Texas Pacific Land Corporation"], ["VLO","Valero Energy"], ["WMB","Williams Companies"],
  ],
  "Utilities": [
    ["AES","AES Corporation"], ["LNT","Alliant Energy"], ["AEE","Ameren"], ["AEP","American Electric Power"], ["AWK","American Water Works"], ["ATO","Atmos Energy"],
    ["CNP","CenterPoint Energy"], ["CMS","CMS Energy"], ["ED","Consolidated Edison"], ["CEG","Constellation Energy"], ["D","Dominion Energy"], ["DTE","DTE Energy"],
    ["DUK","Duke Energy"], ["EIX","Edison International"], ["ETR","Entergy"], ["EVRG","Evergy"], ["ES","Eversource Energy"], ["EXC","Exelon"],
    ["FE","FirstEnergy"], ["NEE","NextEra Energy"], ["NI","NiSource"], ["NRG","NRG Energy"], ["PCG","PG&E Corporation"], ["PNW","Pinnacle West Capital"],
    ["PPL","PPL Corporation"], ["PEG","Public Service Enterprise Group"], ["SRE","Sempra"], ["SO","Southern Company"], ["VST","Vistra Corp."], ["WEC","WEC Energy Group"],
    ["XEL","Xcel Energy"],
  ],
  "Real Estate": [
    ["ARE","Alexandria Real Estate Equities"], ["AMT","American Tower"], ["AVB","AvalonBay Communities"], ["BXP","BXP, Inc."], ["CPT","Camden Property Trust"], ["CBRE","CBRE Group"],
    ["CSGP","CoStar Group"], ["CCI","Crown Castle"], ["DLR","Digital Realty"], ["EQIX","Equinix"], ["EQR","Equity Residential"], ["ESS","Essex Property Trust"],
    ["EXR","Extra Space Storage"], ["FRT","Federal Realty Investment Trust"], ["DOC","Healthpeak Properties"], ["HST","Host Hotels & Resorts"], ["INVH","Invitation Homes"], ["IRM","Iron Mountain"],
    ["KIM","Kimco Realty"], ["MAA","Mid-America Apartment Communities"], ["PLD","Prologis"], ["PSA","Public Storage"], ["O","Realty Income"], ["REG","Regency Centers"],
    ["SBAC","SBA Communications"], ["SPG","Simon Property Group"], ["UDR","UDR, Inc."], ["VTR","Ventas"], ["VICI","Vici Properties"], ["WELL","Welltower"],
    ["WY","Weyerhaeuser"],
  ],
  "Materials": [
    ["APD","Air Products"], ["ALB","Albemarle Corporation"], ["AMCR","Amcor"], ["AVY","Avery Dennison"], ["BALL","Ball Corporation"], ["CF","CF Industries"],
    ["CTVA","Corteva"], ["CRH","CRH plc"], ["DOW","Dow Inc."], ["DD","DuPont"], ["ECL","Ecolab"], ["FCX","Freeport-McMoRan"],
    ["IFF","International Flavors & Fragrances"], ["IP","International Paper"], ["LIN","Linde plc"], ["LYB","LyondellBasell"], ["MLM","Martin Marietta Materials"], ["MOS","Mosaic Company (The)"],
    ["NEM","Newmont"], ["NUE","Nucor"], ["PKG","Packaging Corporation of America"], ["PPG","PPG Industries"], ["SHW","Sherwin-Williams"], ["SW","Smurfit Westrock"],
    ["STLD","Steel Dynamics"], ["VMC","Vulcan Materials Company"],
  ],
};
export const SP500_ALL_SYMBOLS = Object.values(SP500_UNIVERSE).flat().map((x) => x[0]);
export const SP500_SYMBOL_SECTOR = Object.fromEntries(
  Object.entries(SP500_UNIVERSE).flatMap(([sec, arr]) => arr.map(([s]) => [s, sec]))
);
export const SP500_SYMBOL_NAME = Object.fromEntries(SP500_ALL_SYMBOLS.map((s) => [s, SP500_UNIVERSE[SP500_SYMBOL_SECTOR[s]].find((x) => x[0] === s)[1]]));

// อายุแคชของข้อมูล Sector Rotation ก่อนถือว่า "เก่าเกินไป" ต้องสแกนใหม่อัตโนมัติ
// (เดิมสแกนอัตโนมัติแค่ครั้งเดียวต่อการเปิดหน้าเว็บ 1 รอบ ไม่สนอายุข้อมูลเลย ทำให้ถ้าเปิด
// แท็บทิ้งไว้ข้ามวันหรือรีเฟรชหน้าถี่ ๆ ข้อมูลอาจเก่ามาก หรือถูกยิงสแกนใหม่ทั้งที่ข้อมูลยังสดอยู่)
export const SECTOR_CACHE_TTL_MS = 20 * 60 * 1000; // 20 นาที ถือว่ายังสดพอสำหรับ ETF รายสัปดาห์
export const SECTOR_STALE_WARN_MS = 30 * 60 * 1000; // เกิน 30 นาทีขึ้นไป แสดงป้ายเตือนว่าข้อมูลอาจไม่ทันสมัย
export const SECTOR_AUTO_REFRESH_MS = 20 * 60 * 1000; // ระยะห่างของการรีเฟรชอัตโนมัติเมื่อเปิดโหมด Auto-refresh

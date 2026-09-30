/* Housing desk — the words behind every detail panel.
   Keyed by detail ref: "q:SYMBOL" (a quote), "f:FRED_ID" (a FRED series), or a named page.
   what = what the number is; why = why a land developer watches it; rel = related refs. */
window.HD_NOTES = {
  // ------------------------------------------------------------ rates
  'q:US10Y': {
    kind: 'Treasury yield', what: 'The yield on the 10-year U.S. Treasury note, live.',
    why: 'Thirty-year mortgages price off the 10-year, not the Fed, because the typical mortgage is refinanced or paid off within about seven to ten years. Every basis point here reaches the buyer\'s payment within days, and the payment sets what a builder can pay for a lot.',
    rel: ['mort', 'q:US2Y', 'q:US30Y', 'q:MBB', 'q:ITB', 'f:DGS10']
  },
  'q:US2Y': {
    kind: 'Treasury yield', what: 'The yield on the 2-year Treasury note, live.',
    why: 'The 2-year is the market\'s best guess at where the Fed takes short rates over the next two years. It leads fed-funds moves, and the gap to the 10-year (the 2s10s curve) tells you whether the market expects cuts.',
    rel: ['fed', 'q:US10Y', 'q:US3M', 'f:DGS2']
  },
  'q:US30Y': { kind: 'Treasury yield', what: 'The yield on the 30-year Treasury bond, live.', why: 'The long end reflects inflation and deficit risk more than Fed policy. When it rises faster than the 10-year the curve is steepening for term-premium reasons, which tends to keep mortgage rates elevated even through Fed cuts.', rel: ['q:US10Y', 'q:US2Y', 'mort'] },
  'q:US3M': { kind: 'Treasury bill', what: 'The yield on the 3-month Treasury bill, live.', why: 'Sits right on top of fed funds. Construction and A&D loans float over short rates (SOFR or prime), so this is the closest live read on carry cost for a project loan.', rel: ['fed', 'q:US2Y'] },
  'q:US5Y': { kind: 'Treasury yield', what: 'The yield on the 5-year Treasury note, live.', why: 'Five-year money is where a lot of fixed-rate land and commercial debt prices.', rel: ['q:US10Y', 'q:US2Y'] },
  'q:MBB': { kind: 'Mortgage-bond ETF', what: 'iShares MBS ETF: agency mortgage-backed securities.', why: 'MBS prices are what lenders sell loans into. When MBB outperforms Treasuries the mortgage spread is narrowing and rates can fall without the 10-year moving.', rel: ['mort', 'q:US10Y', 'q:RKT'] },
  'mort': {
    kind: 'Mortgage rate', what: 'The 30-year conforming rate, estimated live: the latest Optimal Blue lock-based index, moved one-for-one with the 10-year since that print.',
    why: 'This is the number buyers feel. The spread over the 10-year (normally about 1.7 points, over 3 at the 2023 peak) is set by MBS investor demand, prepayment risk and lender margin, and it can move the rate as much as the Treasury market does.',
    rel: ['q:US10Y', 'f:OBMMIC30YF', 'f:MORTGAGE30US', 'f:MORTGAGE15US', 'f:OBMMIFHA30YF', 'f:OBMMIJUMBO30YF', 'q:MBB']
  },
  'fed': {
    kind: 'Federal Reserve', what: 'The federal funds target range and the FOMC meeting calendar.',
    why: 'Fed funds sets the floor under construction and A&D loan rates (SOFR and prime move with it within a day). It moves mortgages only through expectations, which the 2-year prices in advance, so a cut the market already expects barely registers in the 30-year.',
    rel: ['q:US2Y', 'q:US3M', 'f:DFEDTARU', 'q:US10Y']
  },
  'f:OBMMIC30YF': { what: 'Optimal Blue\'s daily 30-year conforming rate, built from actual locked loans rather than a survey.', why: 'The most current published mortgage rate. It prints with a one-day lag.', rel: ['mort', 'f:MORTGAGE30US', 'q:US10Y'] },
  'f:OBMMIFHA30YF': { what: 'Optimal Blue\'s daily 30-year FHA rate.', why: 'FHA carries a lot of the entry-level, first-time buyer market that production builders sell to.', rel: ['mort', 'f:OBMMIC30YF'] },
  'f:OBMMIJUMBO30YF': { what: 'Optimal Blue\'s daily 30-year jumbo rate, for loans above the conforming limit.', why: 'Prices the move-up and luxury tier. Jumbo sits on bank balance sheets instead of agency MBS, so it can decouple from conforming.', rel: ['mort', 'q:TOL'] },
  'f:MORTGAGE30US': { what: 'Freddie Mac\'s Primary Mortgage Market Survey, 30-year fixed, published Thursdays.', why: 'The long-history benchmark everyone quotes. It lags the daily lock data by a few days.', rel: ['mort', 'f:OBMMIC30YF', 'f:MORTGAGE15US'] },
  'f:MORTGAGE15US': { what: 'Freddie Mac\'s survey rate on the 15-year fixed.', why: 'Mostly a refinance product. The gap to the 30-year shows how steeply lenders price term.', rel: ['f:MORTGAGE30US', 'mort'] },
  'f:DGS10': { what: 'The 10-year Treasury constant-maturity yield, daily close.', why: 'The anchor for mortgage pricing. See the live quote for today.', rel: ['q:US10Y', 'mort'] },
  'f:DGS2': { what: 'The 2-year Treasury constant-maturity yield, daily close.', why: 'Tracks where the market expects fed funds to go.', rel: ['q:US2Y', 'fed'] },
  'f:DFEDTARU': { what: 'Upper bound of the Fed\'s federal funds target range.', why: 'Floor under floating construction and land loan rates.', rel: ['fed', 'q:US2Y'] },
  'f:T10Y2Y': { what: 'The 10-year Treasury yield minus the 2-year, daily.', why: 'Negative means the market expects rate cuts ahead (and historically, slowdown). The re-steepening after an inversion has usually come with Fed cuts.', rel: ['q:US10Y', 'q:US2Y', 'fed'] },

  // ------------------------------------------------------------ market
  'q:ITB': { kind: 'ETF', what: 'iShares U.S. Home Construction ETF. Cap-weighted, so the big four builders (D.R. Horton, Lennar, PulteGroup, NVR) drive most of it, with building products and retailers in the tail.', why: 'The market\'s real-time vote on new-home demand. It tends to move inversely to the 10-year and leads builder order trends by a quarter or two.', rel: ['q:XHB', 'q:DHI', 'q:LEN', 'q:PHM', 'q:US10Y'] },
  'q:XHB': { kind: 'ETF', what: 'SPDR S&P Homebuilders ETF. Equal-weighted and broader than ITB: builders plus building products, furnishings and home retailers.', why: 'When XHB outruns ITB the market is favoring repair-and-remodel and products over new-home builders.', rel: ['q:ITB', 'q:BLDR'] },
  'q:.SPX': { kind: 'Index', what: 'The S&P 500.', why: 'The baseline. Builders are a high-beta group, so the useful read is builders against the S&P, not either alone.', rel: ['q:ITB', 'q:.VIX', 'q:.RUT'] },
  'q:.RUT': { kind: 'Index', what: 'The Russell 2000 small-cap index.', why: 'Small caps carry more floating-rate debt, so they trade as a rate-cut proxy. Most smaller builders and land companies live here.', rel: ['q:.SPX', 'q:US2Y'] },
  'q:.IXIC': { kind: 'Index', what: 'The Nasdaq Composite.', why: 'Growth and tech tone for the broader market.', rel: ['q:.SPX'] },
  'q:.VIX': { kind: 'Volatility index', what: 'The Cboe Volatility Index: 30-day implied volatility on S&P 500 options.', why: 'Risk appetite in one number. Above about 25, builders and land companies usually sell off harder than the market and credit for land deals tightens.', rel: ['q:.SPX', 'q:ITB', 'q:KRE'] },
  'q:KRE': { kind: 'ETF', what: 'SPDR S&P Regional Banking ETF.', why: 'Regional and community banks write most acquisition, development and construction loans. When KRE is under stress, A&D credit gets scarcer and pricier.', rel: ['q:.VIX', 'q:US3M', 'fed'] },
  'q:.DXY': { kind: 'Currency index', what: 'The U.S. Dollar Index against a basket of major currencies.', why: 'A strong dollar lowers the cost of imported materials (Canadian lumber, steel, appliances) and weighs on commodity prices.', rel: ['q:@LBR.1', 'q:@HG.1'] },

  // ------------------------------------------------------------ build costs
  'q:@LBR.1': {
    kind: 'Commodity future', what: 'CME lumber futures, front month: 27,500 board feet of kiln-dried softwood, quoted in dollars per thousand board feet.',
    why: 'Framing lumber and panels are one of the largest material inputs in a single-family house. A lumber move shows up in builder vertical costs within a quarter or two, and in how much of the sale price is left for the lot.',
    calc: 'lumber', rel: ['q:BLDR', 'f:WPU081', 'f:WPUSI012011', 'f:HOUST1F', 'q:.DXY']
  },
  'q:@HG.1': { kind: 'Commodity future', what: 'COMEX copper futures, front month, dollars per pound.', why: 'Wire and plumbing in the house, plus a global-demand barometer ("Dr. Copper").', rel: ['f:WPUSI012011', 'q:@LBR.1'] },
  'q:@CL.1': { kind: 'Commodity future', what: 'NYMEX WTI crude oil futures, front month, dollars per barrel.', why: 'Site work runs on diesel and asphalt, both refined from crude. Earthwork, paving and hauling bids follow oil with a lag.', rel: ['q:@HO.1', 'f:WPUSI012011'] },
  'q:@HO.1': { kind: 'Commodity future', what: 'NYMEX ultra-low-sulfur diesel (heating oil) futures, front month, dollars per gallon.', why: 'The closest traded price to the fuel that runs scrapers, dozers and haul trucks. A 50-cent move matters on a mass-grading job.', rel: ['q:@CL.1'] },
  'q:@HRC.1': { kind: 'Commodity future', what: 'CME Midwest hot-rolled coil steel futures, dollars per short ton.', why: 'A read on the steel complex. Rebar, pipe and structural steel generally move in the same direction.', rel: ['f:WPU101', 'f:WPUSI012011'] },
  'q:@NG.1': { kind: 'Commodity future', what: 'NYMEX natural gas futures, front month.', why: 'An input to cement, PVC and other energy-intensive materials.', rel: ['q:@CL.1'] },
  'q:@GC.1': { kind: 'Commodity future', what: 'COMEX gold futures, front month.', why: 'A fear and real-rate gauge rather than a building cost.', rel: ['q:.DXY', 'q:US10Y'] },
  'f:WPUSI012011': { what: 'Producer Price Index for construction materials, monthly.', why: 'The broad read on what materials cost at the producer level, before contractor markup. It leads bid prices by a few months.', rel: ['f:WPU081', 'f:WPU101', 'q:@LBR.1'] },
  'f:WPUIP2311001': { what: 'Producer Price Index for inputs to residential construction (goods), monthly.', why: 'The material basket weighted the way a house actually uses it. The number to watch for vertical cost inflation.', rel: ['f:WPUSI012011', 'q:@LBR.1'] },
  'f:WPU081': { what: 'Producer Price Index for lumber and wood products, monthly.', why: 'What mills and treaters actually charge, which smooths out the futures market\'s swings.', rel: ['q:@LBR.1', 'q:BLDR'] },
  'f:WPU101': { what: 'Producer Price Index for iron and steel, monthly.', why: 'Rebar, pipe and structural steel.', rel: ['q:@HRC.1', 'f:WPUSI012011'] },
  'f:WPU1321': { what: 'Producer Price Index for construction sand, gravel and crushed stone, monthly.', why: 'Base rock and fill. Aggregates rarely fall in price, so this is a good read on the site-work cost floor.', rel: ['f:WPUSI012011'] },
  'f:WPU1333': { what: 'Producer Price Index for ready-mix concrete, monthly.', why: 'Slabs, curbs and sidewalks. Concrete is local and sticky.', rel: ['f:WPUSI012011'] },
  'f:CES2000000001': { what: 'Construction employment, all employees, monthly (BLS).', why: 'Labor capacity. Tight crews mean longer cycle times and higher sub bids.', rel: ['f:CES2000000003', 'f:UNDCON1FSA'] },
  'f:CES2000000003': { what: 'Average hourly earnings, construction, monthly (BLS).', why: 'Wage inflation in the trades, which feeds straight into site and vertical bids.', rel: ['f:CES2000000001'] },
  'f:CES2023610001': { what: 'Residential building construction employment, monthly (BLS).', why: 'The homebuilding-specific slice of construction labor.', rel: ['f:CES2000000001', 'f:HOUST1F'] },

  // ------------------------------------------------------------ housing
  'f:HOUST1F': { what: 'Single-family housing starts, seasonally adjusted annual rate, monthly (Census).', why: 'Starts consume finished lots. Sustained starts above lot deliveries is what makes lot prices rise.', rel: ['f:PERMIT1', 'f:UNDCON1FSA', 'f:COMPU1USA', 'f:HSN1F'] },
  'f:PERMIT1': { what: 'Single-family building permits, seasonally adjusted annual rate, monthly (Census).', why: 'The earliest hard read on builder intent, one to two months ahead of starts.', rel: ['f:HOUST1F', 'f:FLBPPRIVSA'] },
  'f:HSN1F': { what: 'New single-family homes sold, seasonally adjusted annual rate, monthly (Census). Counted at contract, not closing.', why: 'Absorption. It is noisy month to month (revisions are large), so read the three-month trend.', rel: ['f:MSACSR', 'f:NHFSEPUCS', 'f:MSPNHSUS'] },
  'f:MSACSR': { what: 'Months\' supply of new homes for sale at the current sales pace, monthly (Census).', why: 'Above about six months is a buyer\'s market for new homes. Builders answer with incentives first, then fewer starts, then slower lot takedowns.', rel: ['f:HSN1F', 'f:NHFSEPUCS'] },
  'f:MSPNHSUS': { what: 'Median sales price of new houses sold, monthly (Census).', why: 'Lot values are underwritten as a share of this. A falling median can mean cheaper product mix as much as price cuts.', rel: ['f:CSUSHPINSA', 'f:HSN1F'] },
  'f:NHFSEPUCS': { what: 'New homes for sale that are already completed, monthly (Census).', why: 'Finished, unsold spec. It is the inventory that forces discounting, and it is the first thing builders work down before buying more lots.', rel: ['f:MSACSR', 'f:HSN1F'] },
  'f:CSUSHPINSA': { what: 'S&P CoreLogic Case-Shiller U.S. National Home Price Index, monthly, two-month lag.', why: 'Resale price trend. Resale competes directly with new homes on price.', rel: ['f:MSPNHSUS'] },
  'f:UNDCON1FSA': { what: 'Single-family units under construction, monthly (Census).', why: 'The pipeline between start and completion.', rel: ['f:HOUST1F', 'f:COMPU1USA'] },
  'f:COMPU1USA': { what: 'Single-family completions, monthly (Census).', why: 'Homes coming out of the pipeline and onto the market.', rel: ['f:UNDCON1FSA', 'f:NHFSEPUCS'] },
  'f:HOUST': { what: 'Total housing starts including multifamily, monthly (Census).', why: 'The whole construction cycle. Multifamily swings compete for the same trades.', rel: ['f:HOUST1F'] },
  'f:EXHOSLUSM495S': { what: 'Existing home sales, seasonally adjusted annual rate, monthly (NAR).', why: 'The resale market new homes compete with. Low resale volume is the lock-in effect that has pushed buyers to builders.', rel: ['f:HOSINVUSM495N', 'f:HSN1F'] },
  'f:HOSINVUSM495N': { what: 'Existing homes for sale, monthly (NAR).', why: 'Resale inventory. As it rebuilds, builders lose their monopoly on move-in-ready supply.', rel: ['f:EXHOSLUSM495S'] },
  'f:RHORUSQ156N': { what: 'Homeownership rate, quarterly (Census).', why: 'Slow-moving demographic backdrop.', rel: [] },
  'f:FLBPPRIVSA': { what: 'Florida building permits, all private units, monthly (Census).', why: 'The home state. Florida has been the largest single-family permit market after Texas.', rel: ['f:PERMIT1', 'f:GABPPRIVSA', 'f:NCBPPRIVSA', 'f:SCBPPRIVSA', 'f:TNBPPRIVSA'] },
  'f:GABPPRIVSA': { what: 'Georgia building permits, all private units, monthly (Census).', why: 'Atlanta and Savannah.', rel: ['f:FLBPPRIVSA'] },
  'f:NCBPPRIVSA': { what: 'North Carolina building permits, all private units, monthly (Census).', why: 'Charlotte and Raleigh.', rel: ['f:FLBPPRIVSA'] },
  'f:SCBPPRIVSA': { what: 'South Carolina building permits, all private units, monthly (Census).', why: 'Charleston, Hilton Head, and the Charlotte spillover.', rel: ['f:FLBPPRIVSA'] },
  'f:TNBPPRIVSA': { what: 'Tennessee building permits, all private units, monthly (Census).', why: 'Nashville and its ring counties.', rel: ['f:FLBPPRIVSA'] },

  // ------------------------------------------------------------ companies
  'q:DHI': { what: 'The largest U.S. homebuilder by closings. Entry-level heavy (Express Homes) and majority owner of Forestar, its lot developer.', rel: ['q:FOR', 'q:LEN', 'q:ITB'] },
  'q:LEN': { what: 'Second-largest U.S. builder. Went land-light in 2025 by spinning its land bank into Millrose Properties and buying lots back on option.', rel: ['q:DHI', 'q:ITB'] },
  'q:PHM': { what: 'PulteGroup: Centex (entry), Pulte (move-up) and Del Webb (active adult). Big Florida presence.', rel: ['q:DHI', 'q:TOL'] },
  'q:NVR': { what: 'Ryan Homes and NVHomes. The original land-light builder: it owns almost no land and buys finished lots under option.', why: 'NVR is the model every land-light builder copies, and the reason finished-lot developers exist at scale.', rel: ['q:LEN', 'q:FOR'] },
  'q:TOL': { what: 'Toll Brothers, the luxury and move-up builder. Develops much of its own land.', rel: ['f:OBMMIJUMBO30YF', 'q:PHM'] },
  'q:KBH': { what: 'KB Home, built-to-order, weighted to the West and Texas with a Florida division.', rel: ['q:MTH', 'q:DHI'] },
  'q:MTH': { what: 'Meritage Homes, entry-level spec homes with an energy-efficiency pitch. Heavy in Texas and the Southeast.', rel: ['q:KBH', 'q:LGIH'] },
  'q:MHO': { what: 'M/I Homes, Midwest and Southern builder with Tampa, Orlando and Sarasota divisions.', rel: ['q:CCS', 'q:DFH'] },
  'q:CCS': { what: 'Century Communities, entry-level focused, in about 18 states.', rel: ['q:LGIH', 'q:MHO'] },
  'q:GRBK': { what: 'Green Brick Partners (Trophy Signature Homes), Texas, Atlanta and Florida. Unusual among builders for self-developing most of its lots.', rel: ['q:FOR', 'q:DHI'] },
  'q:LGIH': { what: 'LGI Homes, entry-level spec builder selling to first-time buyers.', rel: ['q:CCS', 'q:MTH'] },
  'q:DFH': { what: 'Dream Finders Homes, Jacksonville-based, run on lot options rather than owned land.', rel: ['q:NVR', 'q:MHO'] },
  'q:BZH': { what: 'Beazer Homes, entry and first move-up, Southeast and Southwest.', rel: ['q:HOV', 'q:CCS'] },
  'q:HOV': { what: 'Hovnanian Enterprises, New Jersey-based, historically the most leveraged public builder.', rel: ['q:BZH'] },
  'q:FOR': { what: 'Forestar Group, a national finished-lot developer, majority-owned by D.R. Horton, which buys most of its lots.', why: 'The closest public comp to a land developer: its lot margins, lot pipeline and sales pace are a direct read on the finished-lot market.', rel: ['q:DHI', 'q:NVR', 'q:GRBK', 'q:JOE'] },
  'q:JOE': { what: 'The St. Joe Company, owner of roughly 170,000 acres in Northwest Florida, developing master-planned communities (including Watersound Origins and Latitude Margaritaville Watersound).', rel: ['q:HHH', 'q:FOR'] },
  'q:HHH': { what: 'Howard Hughes Holdings, developer of master-planned communities (Summerlin, The Woodlands, Bridgeland) that sells superpad land to builders.', why: 'Its MPC land sales price per acre is a public read on builder appetite for land.', rel: ['q:FPH', 'q:JOE'] },
  'q:FPH': { what: 'Five Point Holdings, California master-planned communities (Valencia, Great Park).', rel: ['q:HHH'] },
  'q:BN': { what: 'Brookfield Corporation, the asset manager whose holdings include Brookfield Residential, a large land developer and builder.', rel: ['q:HHH', 'q:FOR'] },
  'q:SKY': { what: 'Champion Homes (formerly Skyline Champion), manufactured and modular homes.', rel: ['q:CVCO'] },
  'q:CVCO': { what: 'Cavco Industries, manufactured homes, with its own consumer-lending arm.', rel: ['q:SKY'] },
  'q:BLDR': { what: 'Builders FirstSource, the largest supplier of lumber, trusses and framing packages to builders.', why: 'Sells lumber at a markup, so its revenue and margin swing with lumber prices and starts.', rel: ['q:@LBR.1', 'f:HOUST1F'] },
  'q:RKT': { what: 'Rocket Companies, the largest mortgage originator (and, since acquiring Mr. Cooper, a large servicer).', why: 'Trades as a leveraged bet on falling rates and refinance volume.', rel: ['mort', 'q:MBB'] }
};

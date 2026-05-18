import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { useQuizStore } from '../store/quizStore';
import { T } from '../styles/theme';

const STATE_FIPS = {
  '01':'Alabama','02':'Alaska','04':'Arizona','05':'Arkansas','06':'California',
  '08':'Colorado','09':'Connecticut','10':'Delaware','12':'Florida','13':'Georgia',
  '15':'Hawaii','16':'Idaho','17':'Illinois','18':'Indiana','19':'Iowa',
  '20':'Kansas','21':'Kentucky','22':'Louisiana','23':'Maine','24':'Maryland',
  '25':'Massachusetts','26':'Michigan','27':'Minnesota','28':'Mississippi',
  '29':'Missouri','30':'Montana','31':'Nebraska','32':'Nevada','33':'New Hampshire',
  '34':'New Jersey','35':'New Mexico','36':'New York','37':'North Carolina',
  '38':'North Dakota','39':'Ohio','40':'Oklahoma','41':'Oregon','42':'Pennsylvania',
  '44':'Rhode Island','45':'South Carolina','46':'South Dakota','47':'Tennessee',
  '48':'Texas','49':'Utah','50':'Vermont','51':'Virginia','53':'Washington',
  '54':'West Virginia','55':'Wisconsin','56':'Wyoming',
};

const STATE_ABBR = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA',
  '08':'CO','09':'CT','10':'DE','12':'FL','13':'GA',
  '15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
  '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
  '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO',
  '30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ',
  '35':'NM','36':'NY','37':'NC','38':'ND','39':'OH',
  '40':'OK','41':'OR','42':'PA','44':'RI','45':'SC',
  '46':'SD','47':'TN','48':'TX','49':'UT','50':'VT',
  '51':'VA','53':'WA','54':'WV','55':'WI','56':'WY',
};

const CATEGORIES = [
  { key: 'counties', label: 'Counties' },
  { key: 'rivers',   label: 'Rivers' },
  { key: 'peaks',    label: 'Peaks' },
  { key: 'parks',    label: 'Parks' },
  { key: 'cities',   label: 'Cities' },
];

export default function USAMap() {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [topo, setTopo] = useState(null);
  const { setActiveState, activeCategory, setActiveCategory } = useQuizStore();

  useEffect(() => {
    fetch('/counties-10m.json').then(r => r.json()).then(setTopo);
  }, []);

  useEffect(() => {
    if (!topo || !svgRef.current) return;

    const width = 960, height = 600;
    const projection = d3.geoAlbersUsa().scale(1300).translate([width / 2, height / 2]);
    const path = d3.geoPath().projection(projection);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const states = topojson.feature(topo, topo.objects.states);
    const stateBorders = topojson.mesh(topo, topo.objects.states, (a, b) => a !== b);

    svg.append('rect').attr('width', width).attr('height', height)
      .attr('fill', T.water).attr('rx', 6);

    svg.append('g').selectAll('path')
      .data(states.features)
      .join('path')
      .attr('d', path)
      .attr('fill', T.countyFill)
      .attr('stroke', 'none')
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        const fips = d.id.toString().padStart(2, '0');
        d3.select(this).attr('fill', T.hover);
        const catLabel = CATEGORIES.find(c => c.key === activeCategory)?.label || 'Counties';
        setTooltip({
          x: event.offsetX, y: event.offsetY,
          text: STATE_FIPS[fips] || 'Unknown',
          sub: `Click to quiz ${catLabel.toLowerCase()} →`,
        });
      })
      .on('mousemove', function(event) {
        setTooltip(t => t ? { ...t, x: event.offsetX, y: event.offsetY } : null);
      })
      .on('mouseout', function() {
        d3.select(this).attr('fill', T.countyFill);
        setTooltip(null);
      })
      .on('click', function(event, d) {
        const fips = d.id.toString().padStart(2, '0');
        const name = STATE_FIPS[fips];
        if (name) setActiveState({ fips, name, category: activeCategory });
      });

    svg.append('path')
      .datum(stateBorders)
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', T.border)
      .attr('stroke-width', 0.8);

    // Abbreviation labels for states with enough screen area
    states.features.forEach(d => {
      const fips = d.id.toString().padStart(2, '0');
      const abbr = STATE_ABBR[fips];
      if (!abbr) return;
      const centroid = path.centroid(d);
      if (!centroid || isNaN(centroid[0])) return;
      const area = path.area(d);
      if (area < 800) return; // skip tiny states
      svg.append('text')
        .attr('x', centroid[0]).attr('y', centroid[1] + 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', area > 6000 ? '11px' : '9px')
        .attr('font-family', 'Raleway, sans-serif')
        .attr('font-weight', '600')
        .attr('fill', '#0a1420')
        .attr('pointer-events', 'none')
        .text(abbr);
    });

  }, [topo, activeCategory]);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', width: '90vw', maxWidth: 1200 }}>
        {CATEGORIES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveCategory(key)}
            style={{
              padding: '5px 14px',
              borderRadius: 4,
              border: `1px solid ${activeCategory === key ? 'rgba(196,144,42,0.7)' : 'rgba(138,172,196,0.25)'}`,
              background: activeCategory === key ? 'rgba(196,144,42,0.18)' : 'transparent',
              color: activeCategory === key ? T.gold : T.textSecondary,
              fontFamily: 'Raleway, sans-serif',
              fontSize: 11,
              fontWeight: activeCategory === key ? 700 : 500,
              cursor: 'pointer',
              letterSpacing: 0.5,
              transition: 'all 0.12s',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ position: 'relative', width: '90vw', maxWidth: 1200, flex: 1, minHeight: 0 }}>
        <svg
          ref={svgRef}
          viewBox="0 0 960 600"
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height: '100%', display: 'block', borderRadius: 6 }}
        />
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: tooltip.x + 12,
          top: tooltip.y - 10,
          background: T.bgTertiary,
          border: `1px solid rgba(138,172,196,0.4)`,
          borderRadius: 4,
          padding: '6px 14px',
          pointerEvents: 'none',
          zIndex: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 15, color: T.textPrimary, fontWeight: 600 }}>
            {tooltip.text}
          </div>
          <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: T.textSecondary, marginTop: 2, letterSpacing: 1 }}>
            {tooltip.sub}
          </div>
        </div>
      )}
      </div>
    </>
  );
}

import React from 'react';

const OnlineWasteHero = () => {
  return (
    <section className="bg-white font-inter py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <p className="text-sm font-semibold tracking-[0.25em] text-gray-500 uppercase">
            Why Cybertect Exists
          </p>
          <h1 className="text-4xl sm:text-5xl font-semibold text-gray-900">
            Online Waste Problem
          </h1>
          <p className="text-lg text-[#333] leading-relaxed max-w-xl">
            Digital advertising doesn’t just lose money to bots—it loses money to bad data. When impressions can’t be
            verified, analytics get inflated, or tags fire twice, your dashboards stay “green” while ROI quietly
            evaporates.
          </p>
          <button className="inline-flex items-center justify-center px-8 py-3 text-base font-semibold text-white rounded-full shadow-lg bg-[#2563EB] hover:bg-[#1d4ed8] transition">
            Run a Waste Scan
          </button>
        </div>

        <div className="flex justify-center lg:justify-end">
          <img
            src="/images/online-waste-hero.jpeg"
            alt="Online Waste Problem illustration showing inflated analytics and duplicated tags"
            className="w-full max-w-[720px] h-auto object-contain"
          />
        </div>
      </div>
    </section>
  );
};

export default OnlineWasteHero;

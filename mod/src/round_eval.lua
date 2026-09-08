local RoundEval = {}

function RoundEval.cash_out_button()
  if not G or not G.round_eval or not G.I or not G.I.UIBOX then return nil end

  for _, ui_box in ipairs(G.I.UIBOX) do
    if ui_box.config and ui_box.config.major == G.round_eval and ui_box.get_UIE_by_ID then
      local button = ui_box:get_UIE_by_ID('cash_out_button')
      if button and button.config and button.config.button == 'cash_out' then return button end
    end
  end
end

return RoundEval

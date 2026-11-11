<#-- BudgetFlow (design 001): each identity provider is a full-width filled pill, "Continue with <provider>". -->
<#macro show social>
  <div id="kc-social-providers" class="${properties.kcFormSocialAccountSectionClass!}">
      <ul class="${properties.kcFormSocialAccountListClass!}">
          <#list social.providers as p>
              <li class="${properties.kcFormSocialAccountListItemClass!}">
                  <a data-once-link data-disabled-class="${properties.kcFormSocialAccountListButtonDisabledClass!}" id="social-${p.alias}"
                          class="${properties.kcFormSocialAccountListButtonClass!} bf-login__sso-button" type="button" href="${p.loginUrl}">
                      <svg class="bf-login__sso-icon" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12.65 10A6 6 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a6 6 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                      </svg>
                      <span class="${properties.kcFormSocialAccountNameClass!}">Continue with ${p.displayName!}</span>
                  </a>
              </li>
          </#list>
      </ul>
  </div>
</#macro>
